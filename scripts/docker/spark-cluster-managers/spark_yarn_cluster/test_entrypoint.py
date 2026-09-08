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

Exercise the entrypoint's cache section against a recording Hadoop
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
if args[:3] == ['dfs', '-ls', '-C']:
    if state.get('list_unavailable') and args[-1] == '/spark/jars':
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
elif args[:2] == ['dfs', '-put'] and args[-1] == '/spark' and state.get('upload_failure'):
    sys.exit(1)
elif args[:2] not in [['dfsadmin', '-safemode'],
                     ['dfs', '-mkdir'], ['dfs', '-rm'], ['dfs', '-put'], ['dfs', '-touchz']]:
    print('Unexpected Hadoop command: ' + repr(args), file=sys.stderr)
    sys.exit(2)
'''


class EntrypointTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zeppelin-entrypoint-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.hadoop = self.root / 'hadoop'
        self.spark = self.root / 'spark'
        (self.spark / 'jars').mkdir(parents=True)
        for name in ['spark-core.jar', 'spark-yarn.jar']:
            (self.spark / 'jars' / name).touch()
        (self.spark / 'RELEASE').write_text('Spark test release\n')
        self.executable(self.hadoop / 'bin/hdfs', HDFS)
        self.state = {
            'jar_directory': True,
            'jars': ['spark-core.jar', 'spark-yarn.jar'],
        }
        source = Path(__file__).with_name('entrypoint.sh').read_text()
        # Exclude SSH-key setup and Spark launch, which use container-only paths.
        source = source[source.index('\"$HADOOP_PREFIX/bin/hdfs\" dfsadmin -safemode leave'):]
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
        env = dict(os.environ, HADOOP_PREFIX=str(self.hadoop),
                   SPARK_HOME=str(self.spark), TEST_STATE=str(state_file),
                   TEST_CALLS=str(calls_file))
        result = subprocess.run(['bash', '-c', self.script], env=env,
                                capture_output=True, text=True, timeout=15)
        self.calls = [json.loads(line) for line in calls_file.read_text().splitlines()]
        return result

    def assert_no_cache_mutation(self):
        self.assertFalse(any(call[:2] in [['dfs', '-put'], ['dfs', '-rm'], ['dfs', '-touchz']]
                             for call in self.calls), self.calls)

    def test_failed_upload_does_not_write_marker(self):
        self.state.update(marker_missing=True, upload_failure=True)
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)
        self.assertFalse(any(call[:2] == ['dfs', '-touchz']
                             for call in self.calls))

    def test_legacy_empty_marker_is_reused_without_release_file(self):
        (self.spark / 'RELEASE').unlink()
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_cache_mutation()

    def test_marker_is_written_only_after_upload(self):
        self.state['marker_missing'] = True
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        upload = self.calls.index(['dfs', '-put', str(self.spark / 'jars'), '/spark'])
        marker = self.calls.index(['dfs', '-touchz', '/spark/.jars-upload-complete'])
        removal = self.calls.index(['dfs', '-rm', '-r', '-f',
                                   '/spark/.jars-upload-complete', '/spark/jars'])
        self.assertLess(removal, upload)
        self.assertLess(upload, marker)

    def test_healthy_cache_is_reused(self):
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_cache_mutation()

    def test_directory_probe_failure_preserves_cache(self):
        self.state['directory_probe_unavailable'] = True
        result = self.run_entrypoint()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Injected directory RPC failure', result.stderr)
        self.assert_no_cache_mutation()

    def test_missing_jar_path_with_existing_marker_is_uploaded(self):
        self.state['jar_directory'] = False
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)

    def test_missing_marker_triggers_upload(self):
        self.state['marker_missing'] = True
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)

    def test_large_parent_listing_reuses_cache(self):
        self.state['parent_entries'] = 10000
        result = self.run_entrypoint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_cache_mutation()

    def test_missing_jars_are_reuploaded(self):
        for jars in [[], ['spark-core.jar']]:
            with self.subTest(jars=jars):
                self.state['jars'] = jars
                result = self.run_entrypoint()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(['dfs', '-put', str(self.spark / 'jars'), '/spark'], self.calls)

    def test_unavailable_jar_listing_preserves_cache(self):
        self.state['list_unavailable'] = True
        result = self.run_entrypoint()
        self.assertIn(['dfs', '-ls', '-C', '/spark/jars'], self.calls)
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_cache_mutation()

if __name__ == '__main__':
    unittest.main()
