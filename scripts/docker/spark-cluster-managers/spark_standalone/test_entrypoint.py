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

"""Verify standalone startup and command forwarding without Docker."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class StandaloneEntrypointTest(unittest.TestCase):
    def run_entrypoint(self, arguments):
        with tempfile.TemporaryDirectory(prefix='zeppelin-standalone-') as temp:
            home = Path(temp)
            (home / 'sbin').mkdir()
            for name in ['start-master.sh', 'start-worker.sh']:
                script = home / 'sbin' / name
                script.write_text('#!/bin/sh\nexit 0\n')
                script.chmod(0o755)
            return subprocess.run(
                ['bash', str(Path(__file__).with_name('entrypoint.sh')), *arguments],
                env=dict(os.environ, SPARK_HOME=temp), capture_output=True,
                text=True, timeout=5)

    def test_command_arguments_are_preserved(self):
        result = self.run_entrypoint(['bash', '-c', 'printf "%s" "$1"',
                                     'argument-test', 'spaces and $literal'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'spaces and $literal')

    def test_command_exit_status_is_preserved(self):
        result = self.run_entrypoint(['bash', '-c', 'exit 7'])
        self.assertEqual(result.returncode, 7)


if __name__ == '__main__':
    unittest.main()
