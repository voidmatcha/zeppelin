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

import { expect, Locator, Page, test } from '@playwright/test';

import { NotebookKeyboardPage } from '../../../models/notebook-keyboard-page';
import { addPageAnnotationBeforeEach, performLoginIfRequired, PAGES, waitForZeppelinReady } from '../../../utils';

const createNote = async (page: Page, notePath: string): Promise<string> => {
  const response = await page.request.post('/api/notebook', {
    data: { notePath, defaultInterpreterGroup: 'python', addingEmptyParagraph: true }
  });
  expect(response.ok(), `Create note failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()).body as string;
};

const getParagraphHostIds = async (page: Page): Promise<string[]> =>
  page
    .locator('zeppelin-notebook-paragraph')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-testid') ?? ''));

type PersistedParagraph = Readonly<{ id: string; text: string; status: string }>;

const getPersistedParagraph = async (page: Page, noteId: string, index: number): Promise<PersistedParagraph> => {
  const response = await page.request.get(`/api/notebook/${noteId}`, { failOnStatusCode: false });
  expect(response.ok(), `Fetch note failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  const body = (await response.json()) as { body?: { paragraphs?: PersistedParagraph[] } };
  const paragraph = body.body?.paragraphs?.[index];
  expect(paragraph, `Paragraph ${index} missing from note ${noteId}`).toBeDefined();
  return paragraph!;
};

const getCoreParagraphValues = async (proof: Locator, attribute: string): Promise<string[]> =>
  JSON.parse((await proof.getAttribute(attribute)) ?? '[]') as string[];

const observeSentOperations = (page: Page): string[] => {
  const operations: string[] = [];
  page.on('websocket', webSocket => {
    webSocket.on('framesent', event => {
      if (typeof event.payload !== 'string') {
        return;
      }
      try {
        const message = JSON.parse(event.payload) as { op?: unknown };
        if (typeof message.op === 'string') {
          operations.push(message.op);
        }
      } catch {
        // Non-JSON development-server frames are unrelated to Zeppelin operations.
      }
    });
  });
  return operations;
};

const notebookWriteOperations = new Set(['PATCH_PARAGRAPH', 'COMMIT_PARAGRAPH', 'RUN_PARAGRAPH']);

test.describe('Notebook Core production route feasibility proof', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);

  test('projects real NOTE state into one cached core while the product route reuses NotebookComponent', async ({
    page
  }) => {
    const sentOperations = observeSentOperations(page);

    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const noteTitleA = `CoreProof_A_${stamp}`;
    const noteTitleB = `CoreProof_B_${stamp}`;
    let noteIdA: string | undefined;
    let noteIdB: string | undefined;

    try {
      noteIdA = await createNote(page, `E2E_TEST_FOLDER/${noteTitleA}`);
      noteIdB = await createNote(page, `E2E_TEST_FOLDER/${noteTitleB}`);
      await page.goto(`/#/notebook/${noteIdA}?coreProof=true`);
      const proof = page.getByTestId('notebook-core-production-route-proof');
      const reactAdapter = page.getByTestId('notebook-core-react-adapter');
      const paragraphHosts = page.locator('zeppelin-notebook-paragraph');
      await expect(proof).toHaveAttribute('data-note-id', noteIdA);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(proof).toHaveAttribute('data-title', noteTitleA);
      await expect(proof).toHaveAttribute('data-paragraph-count', '1');
      await expect(reactAdapter).toHaveAttribute('data-port-shared', 'true', { timeout: 30000 });
      await expect(reactAdapter).toHaveAttribute('data-note-id', noteIdA);
      await expect(reactAdapter).toHaveAttribute('data-title', noteTitleA);
      await expect(reactAdapter).toHaveAttribute('data-paragraph-count', '1');
      await expect(paragraphHosts).toHaveCount(1);
      const firstVersion = Number(await proof.getAttribute('data-version'));
      expect(firstVersion).toBeGreaterThanOrEqual(3);
      await expect(reactAdapter).toHaveAttribute('data-version', String(firstVersion));

      const keyboardPage = new NotebookKeyboardPage(page);

      await test.step('When the active notebook adds and removes a paragraph', async () => {
        await keyboardPage.addParagraph();
        await expect(proof).toHaveAttribute('data-paragraph-count', '2');
        await expect(paragraphHosts).toHaveCount(2);
        await expect.poll(() => sentOperations.filter(operation => operation === 'INSERT_PARAGRAPH').length).toBe(1);
        const addedVersion = Number(await proof.getAttribute('data-version'));
        expect(addedVersion).toBeGreaterThan(firstVersion);

        await keyboardPage.focusParagraphHost(1);
        await keyboardPage.pressDeleteParagraph();
        await keyboardPage.tryClickModalOkButton();
        await keyboardPage.waitForParagraphCountChange(1);
        await expect(proof).toHaveAttribute('data-paragraph-count', '1');
        await expect(paragraphHosts).toHaveCount(1);
        await expect.poll(() => sentOperations.filter(operation => operation === 'PARAGRAPH_REMOVE').length).toBe(1);
        await expect.poll(async () => Number(await proof.getAttribute('data-version'))).toBeGreaterThan(addedVersion);
      });

      await test.step('When the active notebook moves a paragraph', async () => {
        await keyboardPage.addParagraph();
        await expect(proof).toHaveAttribute('data-paragraph-count', '2');
        await expect(paragraphHosts).toHaveCount(2);

        await keyboardPage.setCodeEditorContent('%python\nprint("Core proof first paragraph")', 0);
        await keyboardPage.setCodeEditorContent('%python\nprint("Core proof second paragraph")', 1);

        const initialIds = await getParagraphHostIds(page);
        expect(initialIds).toHaveLength(2);
        await expect(proof).toHaveAttribute('data-paragraph-ids', initialIds.join(','));

        await keyboardPage.focusParagraphHost(1);
        await keyboardPage.pressMoveParagraphUp();

        const expectedMovedIds = [initialIds[1], initialIds[0]];
        await expect.poll(() => getParagraphHostIds(page)).toEqual(expectedMovedIds);
        await expect(proof).toHaveAttribute('data-paragraph-ids', expectedMovedIds.join(','));
        await expect.poll(() => keyboardPage.getParagraphTextByIndex(0)).toContain('Core proof second paragraph');
        await expect.poll(() => keyboardPage.getParagraphTextByIndex(1)).toContain('Core proof first paragraph');
        await expect.poll(() => sentOperations.filter(operation => operation === 'MOVE_PARAGRAPH').length).toBe(1);
      });

      await page.evaluate(
        ({ noteId }) => {
          window.location.hash = `#/notebook/${noteId}?coreProof=true`;
        },
        { noteId: noteIdB }
      );

      await expect(proof).toHaveAttribute('data-note-id', noteIdB);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(proof).toHaveAttribute('data-title', noteTitleB);
      await expect(reactAdapter).toHaveAttribute('data-note-id', noteIdB);
      await expect(reactAdapter).toHaveAttribute('data-title', noteTitleB);
      await expect.poll(async () => Number(await proof.getAttribute('data-version'))).toBeGreaterThan(firstVersion);
    } finally {
      if (noteIdA) {
        await page.request.delete(`/api/notebook/${noteIdA}`);
      }
      if (noteIdB) {
        await page.request.delete(`/api/notebook/${noteIdB}`);
      }
    }
  });

  test('converges an actual editor save and execution across WebSocket, REST, Angular, React, and Core', async ({
    page
  }) => {
    const sentOperations = observeSentOperations(page);

    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const marker = `core_vertical_${stamp}`;
    const code = `%python\nprint("${marker}")`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CoreVertical_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?coreProof=true`);

      const proof = page.getByTestId('notebook-core-production-route-proof');
      const reactAdapter = page.getByTestId('notebook-core-react-adapter');
      const keyboardPage = new NotebookKeyboardPage(page);
      const paragraphResult = keyboardPage.getParagraphByIndex(0).getByTestId('paragraph-result');
      await expect(proof).toHaveAttribute('data-note-id', noteId);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(reactAdapter).toHaveAttribute('data-port-shared', 'true', { timeout: 30000 });
      await expect(reactAdapter).toHaveAttribute('data-note-id', noteId);

      await keyboardPage.tryFocusCodeEditor(0);
      await keyboardPage.pressSelectAll();
      await page.keyboard.insertText(code);
      await keyboardPage.focusParagraphHost(0);

      await expect
        .poll(() => sentOperations.filter(operation => operation === 'COMMIT_PARAGRAPH').length, { timeout: 15000 })
        .toBe(1);
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).text).toBe(code);
      await expect(proof).toHaveAttribute('data-paragraph-texts', JSON.stringify([code]));

      await page.getByRole('button', { name: 'Run first paragraph from React', exact: true }).click();

      await expect(reactAdapter).toHaveAttribute('data-command-accepted', 'true');
      await expect.poll(() => sentOperations.filter(operation => operation === 'RUN_PARAGRAPH').length).toBe(1);
      await expect(keyboardPage.getParagraphStatus(0)).toHaveText('FINISHED', { timeout: 60000 });
      await expect(paragraphResult).toContainText(marker, { timeout: 30000 });
      await expect
        .poll(async () => (await getCoreParagraphValues(proof, 'data-paragraph-statuses'))[0])
        .toBe('FINISHED');
      await expect
        .poll(async () => (await getCoreParagraphValues(reactAdapter, 'data-paragraph-statuses'))[0])
        .toBe('FINISHED');
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).status).toBe('FINISHED');

      await page.goto('/#/');
      await page.goto(`/#/notebook/${noteId}?coreProof=true`);
      await expect(proof).toHaveAttribute('data-note-id', noteId);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(reactAdapter).toHaveAttribute('data-note-id', noteId);
      await expect.poll(async () => (await getCoreParagraphValues(proof, 'data-paragraph-texts'))[0]).toBe(code);
      await expect
        .poll(async () => (await getCoreParagraphValues(proof, 'data-paragraph-statuses'))[0])
        .toBe('FINISHED');
      await expect(paragraphResult).toContainText(marker, { timeout: 30000 });
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('converges two browser-local cores through server-authoritative notebook events', async ({ context, page }) => {
    const peerPage = await context.newPage();
    const sentOperations = observeSentOperations(page);
    const peerSentOperations = observeSentOperations(peerPage);
    const stamp = Date.now();
    const marker = `core_peer_${stamp}`;
    const code = `%python\nprint("${marker}")`;
    let noteId: string | undefined;

    try {
      await Promise.all([page.goto('/#/'), peerPage.goto('/#/')]);
      await Promise.all([waitForZeppelinReady(page), waitForZeppelinReady(peerPage)]);
      await Promise.all([performLoginIfRequired(page), performLoginIfRequired(peerPage)]);

      noteId = await createNote(page, `E2E_TEST_FOLDER/CorePeer_${stamp}`);
      await Promise.all([
        page.goto(`/#/notebook/${noteId}?coreProof=true`),
        peerPage.goto(`/#/notebook/${noteId}?coreProof=true`)
      ]);

      const proof = page.getByTestId('notebook-core-production-route-proof');
      const peerProof = peerPage.getByTestId('notebook-core-production-route-proof');
      const keyboardPage = new NotebookKeyboardPage(page);
      const peerKeyboardPage = new NotebookKeyboardPage(peerPage);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(peerProof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      await keyboardPage.tryFocusCodeEditor(0);
      await keyboardPage.pressSelectAll();
      await page.keyboard.insertText(code);
      await keyboardPage.focusParagraphHost(0);

      await expect
        .poll(() => sentOperations.filter(operation => operation === 'PATCH_PARAGRAPH').length, { timeout: 15000 })
        .toBeGreaterThan(0);
      await expect.poll(() => peerKeyboardPage.getParagraphTextByIndex(0)).toBe(code);
      await expect(proof).toHaveAttribute('data-paragraph-texts', JSON.stringify([code]));
      await expect(peerProof).toHaveAttribute('data-paragraph-texts', JSON.stringify([code]));
      expect(sentOperations.filter(operation => operation === 'COMMIT_PARAGRAPH')).toHaveLength(0);
      expect(peerSentOperations.filter(operation => operation === 'PATCH_PARAGRAPH')).toHaveLength(0);

      await keyboardPage.tryFocusCodeEditor(0);
      await keyboardPage.pressRunParagraph();

      await expect.poll(() => sentOperations.filter(operation => operation === 'RUN_PARAGRAPH').length).toBe(1);
      await expect(keyboardPage.getParagraphStatus(0)).toHaveText('FINISHED', { timeout: 60000 });
      await expect(peerKeyboardPage.getParagraphStatus(0)).toHaveText('FINISHED', { timeout: 60000 });
      await expect(keyboardPage.getParagraphByIndex(0).getByTestId('paragraph-result')).toContainText(marker);
      await expect(peerKeyboardPage.getParagraphByIndex(0).getByTestId('paragraph-result')).toContainText(marker);
      await expect
        .poll(async () => (await getCoreParagraphValues(proof, 'data-paragraph-statuses'))[0])
        .toBe('FINISHED');
      await expect
        .poll(async () => (await getCoreParagraphValues(peerProof, 'data-paragraph-statuses'))[0])
        .toBe('FINISHED');
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).status).toBe('FINISHED');
      expect(peerSentOperations.filter(operation => notebookWriteOperations.has(operation))).toEqual([]);
    } finally {
      await peerPage.close();
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('keeps Angular and Core on the same terminal state after cancelling a real paragraph execution', async ({
    page
  }) => {
    const sentOperations = observeSentOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const code = '%python\nimport time\ntime.sleep(30)\nprint("must not finish before cancellation")';
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CoreCancel_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?coreProof=true&reactFooter=true`);

      const proof = page.getByTestId('notebook-core-production-route-proof');
      const keyboardPage = new NotebookKeyboardPage(page);
      const paragraphStatus = keyboardPage.getParagraphStatus(0);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      await keyboardPage.tryFocusCodeEditor(0);
      await keyboardPage.pressSelectAll();
      await page.keyboard.insertText(code);
      await keyboardPage.focusParagraphHost(0);
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).text).toBe(code);

      await keyboardPage.tryFocusCodeEditor(0);
      await keyboardPage.pressRunParagraph();
      await expect(paragraphStatus).toHaveText(/PENDING|RUNNING/, { timeout: 30000 });
      await expect
        .poll(async () => (await getCoreParagraphValues(proof, 'data-paragraph-statuses'))[0])
        .toMatch(/PENDING|RUNNING/);

      await keyboardPage.pressShortcutFromHostUntil(
        0,
        () => keyboardPage.pressCancel(),
        async () => sentOperations.filter(operation => operation === 'CANCEL_PARAGRAPH').length > 0
      );
      await expect(paragraphStatus).toHaveText('ABORT', { timeout: 45000 });
      const terminalStatus = (await paragraphStatus.textContent())?.trim();
      expect(terminalStatus).toBe('ABORT');
      await expect
        .poll(async () => (await getCoreParagraphValues(proof, 'data-paragraph-statuses'))[0])
        .toBe(terminalStatus);
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).status).toBe('ABORT');
      await expect.poll(() => sentOperations.filter(operation => operation === 'RUN_PARAGRAPH').length).toBe(1);
      await expect.poll(() => sentOperations.filter(operation => operation === 'CANCEL_PARAGRAPH').length).toBe(1);
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });
});
