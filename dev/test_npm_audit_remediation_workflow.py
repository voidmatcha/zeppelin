#!/usr/bin/env python3
#
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
#

import unittest
from pathlib import Path


WORKFLOW = Path(__file__).parents[1] / ".github/workflows/npm-audit-remediation.yml"


class NpmAuditRemediationWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_scopes_pr_token_to_publish_push_and_pr_creation(self):
        prepare_job = self.workflow.index("  prepare:")
        publish_job = self.workflow.index("  publish:")
        prepare_config = self.workflow[prepare_job:publish_job]
        checkout_step = self.workflow.index(
            "name: Checkout audited revision", publish_job
        )
        download_step = self.workflow.index(
            "name: Download remediation artifact", checkout_step
        )
        checkout_config = self.workflow[checkout_step:download_step]
        publish_step = self.workflow.index(
            "name: Create or update remediation pull request"
        )
        publish_script = self.workflow.index("run: |", publish_step)
        token_env = self.workflow[publish_step:publish_script]

        self.assertIn(
            "token: ${{ secrets.NPM_AUDIT_PR_TOKEN || github.token }}",
            checkout_config,
        )
        self.assertIn(
            "GH_TOKEN: ${{ secrets.NPM_AUDIT_PR_TOKEN || github.token }}",
            token_env,
        )
        self.assertNotIn("NPM_AUDIT_PR_TOKEN", prepare_config)
        self.assertNotIn("PR_CREATION_TOKEN:", self.workflow)
        self.assertEqual(
            2,
            self.workflow.count("secrets.NPM_AUDIT_PR_TOKEN || github.token"),
        )

    def test_runs_token_regression_check_when_workflow_or_test_changes(self):
        self.assertIn(
            "- 'dev/test_npm_audit_remediation_workflow.py'", self.workflow
        )
        self.assertIn(
            "run: python3 dev/test_npm_audit_remediation_workflow.py", self.workflow
        )


if __name__ == "__main__":
    unittest.main()
