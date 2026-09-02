/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { expect } from '@playwright/test';

import { startNotebookCoreProofHarness } from './proof-browser-harness.mjs';

let harness;
before(async () => {
  harness = await startNotebookCoreProofHarness();
});

after(async () => {
  await harness?.close();
});

test('React remote receives the exact host-owned NotebookCorePort object', async () => {
  const page = await harness.browser.newPage();

  await page.goto(`${harness.baseUrl}/port-identity`);

  const probe = page.getByTestId('notebook-core-port-probe');
  await expect(probe).toHaveAttribute('data-same-identity', 'true');
  await expect(probe).toHaveAttribute('data-note-id', 'note-host-owned');
  await expect(probe).toHaveAttribute('data-version', '0');

  const hostIdentity = await page.evaluate(() =>
    Object.is(window.__zeppelinNotebookCorePortProof.hostCore, window.__zeppelinNotebookCorePortProof.receivedCore)
  );
  assert.equal(hostIdentity, true);

  await page.getByTestId('publish-notebook-core-revision').click();

  await expect(probe).toHaveAttribute('data-revision-id', 'revision-from-angular-host');
  await expect(probe).toHaveAttribute('data-version', '1');

  const latestProof = await page.evaluate(() => window.__zeppelinNotebookCorePortProof.proofs.at(-1));
  assert.deepEqual(latestProof, {
    sameIdentity: true,
    snapshot: {
      version: 1,
      noteId: 'note-host-owned',
      revisionId: 'revision-from-angular-host',
      phase: 'idle',
      title: null,
      paragraphs: [],
      error: null
    },
    updateCount: 1
  });

  await page.close();
});
