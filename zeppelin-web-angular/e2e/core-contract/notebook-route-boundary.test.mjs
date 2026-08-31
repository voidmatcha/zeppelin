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

test('Angular owns notebook route parsing and passes one port to the React remote', async () => {
  const page = await harness.browser.newPage();
  await page.goto(`${harness.baseUrl}/notebook/note-from-route`);

  const probe = page.getByTestId('notebook-core-port-probe');
  await expect(probe).toHaveAttribute('data-same-identity', 'true');
  await expect(probe).toHaveAttribute('data-note-id', 'note-from-route');
  await expect(probe).toHaveAttribute('data-revision-id', '');
  await expect(probe).toHaveAttribute('data-update-count', '0');

  await page.getByTestId('navigate-notebook-note').click();
  await expect(page).toHaveURL(`${harness.baseUrl}/notebook/note-route-updated`);
  await expect(probe).toHaveAttribute('data-note-id', 'note-route-updated');
  await expect(probe).toHaveAttribute('data-update-count', '1');

  await page.getByTestId('navigate-notebook-revision').click();
  await expect(page).toHaveURL(`${harness.baseUrl}/notebook/note-route-updated/revision/revision-from-route`);
  await expect(probe).toHaveAttribute('data-same-identity', 'true');
  await expect(probe).toHaveAttribute('data-note-id', 'note-route-updated');
  await expect(probe).toHaveAttribute('data-revision-id', 'revision-from-route');
  await expect(probe).toHaveAttribute('data-update-count', '2');

  const routeProof = await page.evaluate(() => {
    const proofState = window.__zeppelinNotebookRouteBoundaryProof;
    return {
      allReceivedPortsAreHostOwned: proofState.receivedCores.every(core => Object.is(core, proofState.hostCore)),
      latestPortIsHostOwned: Object.is(proofState.receivedCore, proofState.hostCore),
      receivedPortCount: new Set(proofState.receivedCores).size,
      snapshot: proofState.hostCore.getSnapshot()
    };
  });
  assert.deepEqual(routeProof, {
    allReceivedPortsAreHostOwned: true,
    latestPortIsHostOwned: true,
    receivedPortCount: 1,
    snapshot: { noteId: 'note-route-updated', revisionId: 'revision-from-route' }
  });

  await page.close();
});
