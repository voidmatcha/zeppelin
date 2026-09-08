#!/usr/bin/env python3
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Run with python3 test_entrypoint.py; no Docker or Hadoop installation needed.

Exercise the entrypoint's storage/startup section against a recording Hadoop
CLI. Docker integration checks additionally verify real Hadoop behavior.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


HDFS = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
state = json.loads(Path(os.environ['TEST_STATE']).read_text())
with open(os.environ['TEST_CALLS'], 'a') as calls:
    calls.write(json.dumps(args) + '\n')
if args[0] == 'getconf':
    print(state[args[-1]])
elif args[:2] == ['dfsadmin', '-report']:
    print('Live datanodes (1):')
elif args[0] == 'fsck':
    status = state['jar_status' if args[1] == '/spark/jars' else 'root_status']
    if status == 'UNAVAILABLE':
        print('Connection refused', file=sys.stderr)
        sys.exit(1)
    print('Status: ' + status)
    sys.exit(0 if status == 'HEALTHY' else 1)
elif args[:3] == ['dfs', '-test', '-d']:
    if state.get('directory_probe_unavailable'):
        print('Injected directory RPC failure', file=sys.stderr)
        sys.exit(1)
    sys.exit(0 if state['jar_directory'] else 1)
elif args[:2] == ['dfs', '-cat']:
    if state.get('marker_missing'):
        print('No such file or directory', file=sys.stderr)
        sys.exit(1)
    if state.get('marker_unavailable'):
        print('Injected marker RPC failure', file=sys.stderr)
        sys.exit(2)
    print(state['marker'])
elif args[:3] == ['dfs', '-ls', '-C']:
    if state.get('list_unavailable'):
        print('Connection refused', file=sys.stderr)
        sys.exit(1)
    if args[-1] == '/spark':
        if state.get('directory_probe_unavailable'):
            print('Injected directory RPC failure', file=sys.stderr)
            sys.exit(1)
        if state['jar_directory']:
            print('/spark/jars')
        if not state.get('marker_missing'):
            print('/spark/.jars-upload-complete')
        for index in range(state.get('parent_entries', 0)):
            print('/spark/other-entry-' + str(index))
    else:
        for name in state['jars']:
            print('/spark/jars/' + name)
elif args[:2] not in [['namenode', '-format'], ['dfsadmin', '-safemode'],
                     ['dfs', '-mkdir'], ['dfs', '-rm'], ['dfs', '-put']]:
    print('Unexpected Hadoop command: ' + repr(args), file=sys.stderr)
    sys.exit(2)
'''


class EntrypointTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zeppelin-entrypoint-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.name = self.root / 'name'
        self.data = self.root / 'data'
        (self.name / 'current').mkdir(parents=True)
        (self.name / 'current/VERSION').touch()
        (self.data / 'current').mkdir(parents=True)
        (self.data / 'current/VERSION').touch()
        self.hadoop = self.root / 'hadoop'
        self.spark = self.root / 'spark'
        (self.spark / 'jars').mkdir(parents=True)
        for name in ['spark-core.jar', 'spark-yarn.jar']:
            (self.spark / 'jars' / name).touch()
        (self.spark / 'RELEASE').write_text('Spark test release\n')
        self.executable(self.hadoop / 'bin/hdfs', HDFS)
        for name in ['start-dfs.sh', 'start-yarn.sh']:
            self.executable(self.hadoop / 'sbin' / name, '#!/bin/sh\nexit 0\n')
        self.executable(self.root / 'bin/service', '#!/bin/sh\nexit 0\n')
        self.executable(self.root / 'bin/jps', '#!/bin/sh\necho "123 NameNode"\n')
        self.state = {
            'dfs.namenode.name.dir': str(self.name),
            'dfs.datanode.data.dir': str(self.data),
            'jar_directory': True,
            'jars': ['spark-core.jar', 'spark-yarn.jar'],
            'marker': 'Spark test release',
            'jar_status': 'HEALTHY',
            'root_status': 'HEALTHY',
        }
        source = Path(__file__).with_name('entrypoint.sh').read_text()
        # Exclude SSH-key setup and Spark launch, which use container-only paths.
        source = source[source.index('# format on first start only.'):]
        self.script = 'set -euo pipefail\n' + source.split('# start spark\n')[0]

    @staticmethod
    def executable(path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o755)

    def run_entrypoint(self):
        state_file = self.root / 'state.json'
        calls_file = self.root / 'calls.jsonl'
        state_file.write_text(json.dumps(self.state))
        calls_file.write_text('')
        env = dict(os.environ, HADOOP_HOME=str(self.hadoop),
                   SPARK_HOME=str(self.spark), TEST_STATE=str(state_file),
                   TEST_CALLS=str(calls_file),
                   PATH=str(self.root / 'bin') + os.pathsep + os.environ['PATH'])
        result = subprocess.run(['bash', '-c', self.script], env=env,
                                capture_output=True, text=True, timeout=15)
        self.calls = [json.loads(line) for line in calls_file.read_text().splitlines()]
        return result

    def assert_no_upload_or_format(self):
        self.assertFalse(any(call[0] == 'namenode' or call[:2] in [['dfs', '-put'], ['dfs', '-rm']]
                             for call in self.calls), self.calls)

    def test_empty_volume_is_formatted_and_uploaded(self):
        for directory in [self.name, self.data]:
            (directory / 'current/VERSION').unlink()
            (directory / 'current').rmdir()
        self.state['jar_directory'] = False
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls.count(['namenode', '-format', '-nonInteractive']), 1)
        self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)

    def test_healthy_volume_paths(self):
        for prefix in ['', 'file:', 'file://']:
            with self.subTest(prefix=prefix):
                self.state['dfs.namenode.name.dir'] = prefix + str(self.name)
                self.state['dfs.datanode.data.dir'] = prefix + str(self.data)
                result = self.run_entrypoint()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_no_upload_or_format()

    def test_comma_entries_preserve_spaces_inside_paths(self):
        renamed = self.root / 'name with spaces'
        self.name.rename(renamed)
        self.state['dfs.namenode.name.dir'] = ' ,  file:' + str(renamed) + ' , '
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_upload_or_format()

    def test_uri_authority_is_rejected_before_formatting(self):
        self.state['dfs.namenode.name.dir'] = 'file://remote/data/name'
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unsupported storage URI authority', result.stderr)
        self.assert_no_upload_or_format()

    def test_remaining_blocks_without_either_version_prevent_format(self):
        (self.name / 'current/VERSION').unlink()
        (self.name / 'current').rmdir()
        (self.data / 'current/VERSION').unlink()
        block = self.data / 'current/BP-test/finalized/blk_1'
        block.parent.mkdir(parents=True)
        block.write_bytes(b'preserve this data')
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_upload_or_format()
        self.assertEqual(block.read_bytes(), b'preserve this data')

    def test_encoded_storage_uri_is_rejected_before_formatting(self):
        for key in ['dfs.namenode.name.dir', 'dfs.datanode.data.dir']:
            with self.subTest(key=key):
                self.state['dfs.namenode.name.dir'] = str(self.root / 'absent-name')
                self.state['dfs.datanode.data.dir'] = str(self.data)
                self.state[key] = 'file:' + str(self.root / 'storage%20space')
                result = self.run_entrypoint()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Percent-encoded storage URIs are not supported', result.stderr)
                self.assert_no_upload_or_format()

    def test_invalid_release_preserves_existing_cache(self):
        for release in ['', '\nSpark release\n', None]:
            with self.subTest(release=release):
                release_file = self.spark / 'RELEASE'
                if release is None:
                    release_file.unlink()
                else:
                    release_file.write_text(release)
                self.state.update(marker='', jars=[])
                result = self.run_entrypoint()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Cannot determine the Spark release', result.stderr)
                self.assert_no_upload_or_format()

    def test_half_formatted_name_directory_prevents_format(self):
        (self.name / 'current/VERSION').unlink()
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no VERSION', result.stderr)
        self.assert_no_upload_or_format()

    def test_typed_datanode_storage_prevents_format(self):
        (self.name / 'current/VERSION').unlink()
        (self.name / 'current').rmdir()
        for path in [f'[DISK]{self.data}', f' [SSD]file:{self.data} ',
                     f'[DISK] file://{self.data}']:
            with self.subTest(path=path):
                self.state['dfs.datanode.data.dir'] = path
                result = self.run_entrypoint()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('holds datanode storage files', result.stderr)
                self.assert_no_upload_or_format()

    def test_unrecognized_storage_path_prevents_format(self):
        (self.name / 'current/VERSION').unlink()
        (self.name / 'current').rmdir()
        for path in ['[DISK/data/hdfs', 'relative/path', '[DISK]file:///data/name%20space']:
            with self.subTest(path=path):
                self.state['dfs.datanode.data.dir'] = path
                result = self.run_entrypoint()
                self.assertNotEqual(result.returncode, 0)
                self.assert_no_upload_or_format()

    def test_directory_probe_failure_preserves_cache(self):
        self.state['directory_probe_unavailable'] = True
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Injected directory RPC failure', result.stderr)
        self.assert_no_upload_or_format()

    def test_missing_jar_path_with_existing_marker_is_uploaded(self):
        self.state['jar_directory'] = False
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)

    def test_marker_read_error_preserves_cache_and_diagnostic(self):
        self.state['marker_unavailable'] = True
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Injected marker RPC failure', result.stderr)
        self.assert_no_upload_or_format()

    def test_missing_marker_triggers_upload(self):
        self.state['marker_missing'] = True
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)

    def test_large_parent_listing_reuses_cache(self):
        self.state['parent_entries'] = 10000
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_upload_or_format()

    def test_secondary_namenode_does_not_count_as_namenode(self):
        self.executable(self.root / 'bin/jps', '#!/bin/sh\necho "123 SecondaryNameNode"\n')
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('namenode did not start', result.stderr)
        self.assertNotIn(['dfsadmin', '-safemode', 'leave'], self.calls)

    def test_unknown_root_health_does_not_claim_data_loss(self):
        self.state['root_status'] = 'UNAVAILABLE'
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('could not', result.stderr.lower())
        self.assertIn('Connection refused', result.stderr)
        self.assertNotIn('cannot be read', result.stderr)
        self.assertNotIn('missing blocks', result.stderr)

    def test_corrupt_root_still_warns(self):
        self.state['root_status'] = 'CORRUPT'
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Warning:', result.stderr)
        self.assert_no_upload_or_format()

    def test_unknown_jar_health_preserves_cache(self):
        self.state['jar_status'] = 'UNAVAILABLE'
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_upload_or_format()

    def test_missing_jars_are_reuploaded_despite_healthy_fsck(self):
        for jars in [[], ['spark-core.jar']]:
            with self.subTest(jars=jars):
                self.state['jars'] = jars
                result = self.run_entrypoint()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)

    def test_unavailable_jar_listing_preserves_cache(self):
        self.state['list_unavailable'] = True
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_upload_or_format()
        self.assertFalse(any(call[:2] == ['dfs', '-rm'] for call in self.calls))

    def test_corrupt_jars_are_reuploaded(self):
        self.state['jar_status'] = 'CORRUPT'
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)


if __name__ == '__main__':
    unittest.main()
