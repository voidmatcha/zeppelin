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
  const angularAdapter = page.getByTestId('notebook-angular-adapter');
  await expect(probe).toHaveAttribute('data-same-identity', 'true');
  await expect(probe).toHaveAttribute('data-note-id', 'note-from-route');
  await expect(probe).toHaveAttribute('data-revision-id', '');
  await expect(probe).toHaveAttribute('data-phase', 'loading');
  await expect(angularAdapter).toHaveAttribute('data-note-id', 'note-from-route');
  await expect(angularAdapter).toHaveAttribute('data-phase', 'loading');
  const initialVersion = Number(await probe.getAttribute('data-version'));
  expect(initialVersion).toBeGreaterThan(0);

  await page.getByTestId('load-notebook-fixture').click();
  await expect(probe).toHaveAttribute('data-phase', 'ready');
  await expect(probe).toHaveAttribute('data-title', 'Fixture note-from-route');
  await expect(probe).toHaveAttribute('data-paragraph-count', '2');
  await expect(angularAdapter).toHaveAttribute('data-phase', 'ready');
  await expect(angularAdapter).toHaveAttribute('data-title', 'Fixture note-from-route');
  await expect(angularAdapter).toHaveAttribute('data-paragraph-count', '2');
  const loadedInitialVersion = Number(await probe.getAttribute('data-version'));
  expect(loadedInitialVersion).toBeGreaterThan(initialVersion);

  await page.getByTestId('navigate-notebook-note').click();
  await expect(page).toHaveURL(`${harness.baseUrl}/notebook/note-route-updated`);
  await expect(probe).toHaveAttribute('data-note-id', 'note-route-updated');
  await expect(probe).toHaveAttribute('data-phase', 'loading');
  await expect(angularAdapter).toHaveAttribute('data-note-id', 'note-route-updated');
  await expect(angularAdapter).toHaveAttribute('data-phase', 'loading');
  const updatedRouteVersion = Number(await probe.getAttribute('data-version'));
  expect(updatedRouteVersion).toBeGreaterThan(loadedInitialVersion);

  await page.getByTestId('apply-notebook-mutation').click();
  await expect(probe).toHaveAttribute('data-version', String(updatedRouteVersion));
  await expect(probe).toHaveAttribute('data-paragraph-count', '0');

  await page.getByTestId('load-stale-notebook-fixture').click();
  await expect(probe).toHaveAttribute('data-note-id', 'note-route-updated');
  await expect(probe).toHaveAttribute('data-phase', 'loading');
  await expect(probe).toHaveAttribute('data-title', '');
  await expect(probe).toHaveAttribute('data-version', String(updatedRouteVersion));

  await page.getByTestId('load-notebook-fixture').click();
  await expect(probe).toHaveAttribute('data-title', 'Fixture note-route-updated');
  await expect(angularAdapter).toHaveAttribute('data-title', 'Fixture note-route-updated');
  const loadedUpdatedVersion = Number(await probe.getAttribute('data-version'));
  expect(loadedUpdatedVersion).toBeGreaterThan(updatedRouteVersion);

  await page.getByTestId('apply-notebook-mutation').click();
  await expect(probe).toHaveAttribute('data-paragraph-count', '3');
  await expect(angularAdapter).toHaveAttribute('data-paragraph-count', '3');
  const mutatedUpdatedVersion = Number(await probe.getAttribute('data-version'));
  expect(mutatedUpdatedVersion).toBeGreaterThan(loadedUpdatedVersion);

  await page.getByTestId('navigate-notebook-revision').click();
  await expect(page).toHaveURL(`${harness.baseUrl}/notebook/note-route-updated/revision/revision-from-route`);
  await expect(probe).toHaveAttribute('data-same-identity', 'true');
  await expect(probe).toHaveAttribute('data-note-id', 'note-route-updated');
  await expect(probe).toHaveAttribute('data-revision-id', 'revision-from-route');
  await expect(probe).toHaveAttribute('data-phase', 'loading');
  const revisionRouteVersion = Number(await probe.getAttribute('data-version'));
  expect(revisionRouteVersion).toBeGreaterThan(mutatedUpdatedVersion);

  await page.getByTestId('load-notebook-fixture').click();
  const loadedRevisionVersion = Number(await probe.getAttribute('data-version'));
  expect(loadedRevisionVersion).toBeGreaterThan(revisionRouteVersion);
  await expect(angularAdapter).toHaveAttribute('data-version', String(loadedRevisionVersion));

  const routeProof = await page.evaluate(() => {
    const proofState = window.__zeppelinNotebookRouteBoundaryProof;
    return {
      allReceivedPortsAreHostOwned: proofState.receivedCores.every(core => Object.is(core, proofState.hostCore)),
      latestPortIsHostOwned: Object.is(proofState.receivedCore, proofState.hostCore),
      receivedPortCount: new Set(proofState.receivedCores).size,
      snapshot: proofState.hostCore.getSnapshot()
    };
  });
  assert.equal(routeProof.allReceivedPortsAreHostOwned, true);
  assert.equal(routeProof.latestPortIsHostOwned, true);
  assert.equal(routeProof.receivedPortCount, 1);
  assert.equal(routeProof.snapshot.version, loadedRevisionVersion);
  assert.deepEqual(
    { ...routeProof.snapshot, version: undefined },
    {
      noteId: 'note-route-updated',
      revisionId: 'revision-from-route',
      phase: 'ready',
      title: 'Fixture note-route-updated',
      paragraphs: [
        { id: 'paragraph-1', text: '%md shared state', status: 'FINISHED' },
        { id: 'paragraph-2', text: '%spark 1 + 1', status: 'READY' }
      ],
      error: null,
      version: undefined
    }
  );

  await page.close();
});

test('a remote load failure keeps the URL and activates the Angular fallback over the same core', async () => {
  const page = await harness.browser.newPage();
  await page.goto(`${harness.baseUrl}/notebook/fallback-note?simulateRemoteFailure=true`);

  await expect(page.getByTestId('notebook-angular-fallback')).toBeVisible();
  await expect(page.getByTestId('notebook-angular-fallback')).toHaveAttribute('data-note-id', 'fallback-note');
  await expect(page).toHaveURL(`${harness.baseUrl}/notebook/fallback-note?simulateRemoteFailure=true`);
  await expect(page.getByTestId('notebook-core-port-probe')).toHaveCount(0);

  await page.getByTestId('load-notebook-fixture').click();
  await expect(page.getByTestId('notebook-angular-fallback')).toHaveAttribute('data-phase', 'ready');
  await expect(page.getByTestId('notebook-angular-fallback')).toHaveAttribute('data-title', 'Fixture fallback-note');
  await expect(page.getByTestId('notebook-angular-fallback')).toHaveAttribute('data-paragraph-count', '2');

  await page.close();
});
