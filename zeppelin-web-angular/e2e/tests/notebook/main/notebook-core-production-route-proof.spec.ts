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

import { LoginPage } from '../../../models/login-page';
import { NotebookKeyboardPage } from '../../../models/notebook-keyboard-page';
import { addPageAnnotationBeforeEach, performLoginIfRequired, PAGES, waitForZeppelinReady } from '../../../utils';

const createNote = async (page: Page, notePath: string): Promise<string> => {
  const response = await page.request.post('/api/notebook', {
    data: { notePath, defaultInterpreterGroup: 'python', addingEmptyParagraph: true }
  });
  expect(response.ok(), `Create note failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()).body as string;
};

const loginAs = async (page: Page, username: string, password: string): Promise<void> => {
  await page.goto('/#/login');
  const loginPage = new LoginPage(page);
  await loginPage.login(username, password);
  await expect(page.locator('zeppelin-login')).toBeHidden({ timeout: 30000 });
  await waitForZeppelinReady(page);
  const ticket = await page.request.get('/api/security/ticket');
  expect(ticket.ok(), `Ticket lookup failed: ${ticket.status()} ${await ticket.text()}`).toBeTruthy();
  expect(((await ticket.json()) as { body?: { principal?: string } }).body?.principal).toBe(username);
};

const grantNotebookAccess = async (page: Page, noteId: string, user: string): Promise<void> => {
  const response = await page.request.put(`/api/notebook/${noteId}/permissions`, {
    data: {
      owners: ['user1'],
      readers: ['user1', user],
      writers: ['user1', user],
      runners: ['user1', user]
    }
  });
  expect(response.ok(), `Set note permissions failed: ${response.status()} ${await response.text()}`).toBeTruthy();
};

const getParagraphHostIds = async (page: Page): Promise<string[]> =>
  page
    .locator('zeppelin-notebook-paragraph')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-testid') ?? ''));

type PersistedParagraph = Readonly<{
  id: string;
  text: string;
  status: string;
  config?: { results?: Record<string, { graph?: { mode?: string } }> };
}>;

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

type ReceivedOperation = Readonly<{ op: string; data: unknown }>;

const observeReceivedOperations = (page: Page): ReceivedOperation[] => {
  const operations: ReceivedOperation[] = [];
  page.on('websocket', webSocket => {
    webSocket.on('framereceived', event => {
      if (typeof event.payload !== 'string') {
        return;
      }
      try {
        const message = JSON.parse(event.payload) as { op?: unknown; data?: unknown };
        if (typeof message.op === 'string') {
          operations.push({ op: message.op, data: message.data });
        }
      } catch {
        // Non-JSON development-server frames are unrelated to Zeppelin operations.
      }
    });
  });
  return operations;
};

const notebookWriteOperations = new Set(['PATCH_PARAGRAPH', 'COMMIT_PARAGRAPH', 'RUN_PARAGRAPH']);
const coldInterpreterExecutionTimeout = 90000;

test.describe('Notebook Core production route feasibility proof', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);

  test('keeps the React notebook theme synchronized with the Angular host', async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CoreTheme_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      const reactAdapter = page.getByTestId('notebook-core-react-adapter');
      await expect(reactAdapter).toHaveAttribute('data-port-shared', 'true', { timeout: 30000 });

      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await expect(reactAdapter).toHaveAttribute('data-host-theme', 'dark');

      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await expect(reactAdapter).toHaveAttribute('data-host-theme', 'light');
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

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
      await page.goto(`/#/notebook/${noteIdA}?coreProof=true&reactNotebook=false`);
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
          window.location.hash = `#/notebook/${noteId}?coreProof=true&reactNotebook=false`;
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
    const receivedOperations = observeReceivedOperations(page);

    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const marker = `core_vertical_${stamp}`;
    const code = `%python\nprint("${marker}")`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CoreVertical_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?coreProof=true&reactNotebook=false`);

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
      await expect(reactAdapter.getByRole('textbox', { name: 'Paragraph 1 editor' })).toHaveValue(code);

      await reactAdapter.getByRole('button', { name: 'Run', exact: true }).click();

      await expect(reactAdapter).toHaveAttribute('data-command-accepted', 'true');
      await expect.poll(() => sentOperations.filter(operation => operation === 'RUN_PARAGRAPH').length).toBe(1);
      await expect
        .poll(() => receivedOperations.filter(operation => operation.op === 'PARAGRAPH_APPEND_OUTPUT').length)
        .toBeGreaterThan(0);
      const appendOutput = receivedOperations.find(operation => operation.op === 'PARAGRAPH_APPEND_OUTPUT');
      expect(appendOutput).toMatchObject({
        data: {
          paragraphId: (await getParagraphHostIds(page))[0],
          index: expect.any(Number),
          data: expect.any(String),
          outputSequence: expect.any(Number)
        }
      });
      await expect(keyboardPage.getParagraphStatus(0)).toHaveText('FINISHED', { timeout: 60000 });
      await expect(paragraphResult).toContainText(marker, { timeout: 30000 });
      await expect(proof).toHaveAttribute('data-paragraph-results', new RegExp(marker), { timeout: 30000 });
      await expect(reactAdapter.getByTestId('react-notebook-core-results')).toContainText(marker, { timeout: 30000 });
      await expect
        .poll(async () => (await getCoreParagraphValues(proof, 'data-paragraph-statuses'))[0])
        .toBe('FINISHED');
      await expect
        .poll(async () => (await getCoreParagraphValues(reactAdapter, 'data-paragraph-statuses'))[0])
        .toBe('FINISHED');
      await expect(reactAdapter.getByRole('article', { name: 'Paragraph 1' })).toContainText('FINISHED');
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).status).toBe('FINISHED');

      await page.goto('/#/');
      await page.goto(`/#/notebook/${noteId}?coreProof=true&reactNotebook=false`);
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

  test('recovers the active Core route after the browser returns online', async ({ context, page }) => {
    const receivedOperations = observeReceivedOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CoreReconnect_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?coreProof=true&reactNotebook=false`);
      const proof = page.getByTestId('notebook-core-production-route-proof');
      await expect(proof).toHaveAttribute('data-note-id', noteId);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      const noteEventsBeforeOffline = receivedOperations.filter(operation => operation.op === 'NOTE').length;
      await context.setOffline(true);
      await page.waitForTimeout(250);
      await context.setOffline(false);

      await expect
        .poll(() => receivedOperations.filter(operation => operation.op === 'NOTE').length, { timeout: 30000 })
        .toBeGreaterThan(noteEventsBeforeOffline);
      await expect(proof).toHaveAttribute('data-note-id', noteId);
      await expect(proof).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
    } finally {
      await context.setOffline(false);
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('recovers the active React notebook after the browser returns online', async ({ context, page }) => {
    const receivedOperations = observeReceivedOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactReconnect_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      await expect(reactNotebook).toHaveAttribute('data-note-id', noteId, { timeout: 30000 });
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      const noteEventsBeforeOffline = receivedOperations.filter(operation => operation.op === 'NOTE').length;
      await context.setOffline(true);
      await page.waitForTimeout(250);
      await context.setOffline(false);

      await expect
        .poll(() => receivedOperations.filter(operation => operation.op === 'NOTE').length, { timeout: 30000 })
        .toBeGreaterThan(noteEventsBeforeOffline);
      await expect(reactNotebook).toHaveAttribute('data-note-id', noteId);
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(reactNotebook.getByRole('textbox', { name: 'Paragraph 1 editor' })).toBeVisible();
    } finally {
      await context.setOffline(false);
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('recovers active React output from an authoritative snapshot after reconnecting', async ({ context, page }) => {
    const sentOperations = observeSentOperations(page);
    const receivedOperations = observeReceivedOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const marker = `react_output_recovery_${stamp}`;
    const markerFirst = `${marker}_first`;
    const markerSecond = `${marker}_second`;
    const code = `%python\nimport time\nprint("${markerFirst}")\ntime.sleep(5)\nprint("${markerSecond}")`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactOutputRecovery_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = page.getByRole('textbox', { name: 'Paragraph 1 editor' });
      const paragraphResult = reactNotebook.getByTestId('react-notebook-core-results');
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      await editor.fill(code);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).text).toBe(code);

      await reactNotebook.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(paragraphResult).toContainText(markerFirst, { timeout: coldInterpreterExecutionTimeout });

      const snapshotCountBeforeOffline = receivedOperations.filter(
        operation => operation.op === 'PARAGRAPH_OUTPUT_SNAPSHOT'
      ).length;
      await context.setOffline(true);
      await page.waitForFunction(() => navigator.onLine === false);
      await context.setOffline(false);

      await expect
        .poll(() => sentOperations.filter(operation => operation === 'GET_PARAGRAPH_OUTPUT').length, { timeout: 30000 })
        .toBeGreaterThan(0);
      await expect
        .poll(() => receivedOperations.filter(operation => operation.op === 'PARAGRAPH_OUTPUT_SNAPSHOT').length, {
          timeout: 30000
        })
        .toBeGreaterThan(snapshotCountBeforeOffline);
      const snapshot = receivedOperations.find(
        operation =>
          operation.op === 'PARAGRAPH_OUTPUT_SNAPSHOT' &&
          typeof operation.data === 'object' &&
          operation.data !== null &&
          JSON.stringify(operation.data).includes(markerFirst)
      );
      expect(snapshot).toMatchObject({
        data: {
          paragraphId: (await getPersistedParagraph(page, noteId, 0)).id,
          outputSequence: expect.any(Number)
        }
      });
      await expect(paragraphResult).toContainText(markerSecond, { timeout: coldInterpreterExecutionTimeout });
    } finally {
      await context.setOffline(false);
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('renders and operates the editable notebook body in React', async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const marker = `react_notebook_${stamp}`;
    const code = `%python\nprint("${marker}")`;
    const renamedTitle = `ReactNotebookRenamed_${stamp}`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactNotebook_${stamp}`);
      await page.goto(`/#/notebook/${noteId}`);

      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = page.getByRole('textbox', { name: 'Paragraph 1 editor' });
      await expect(reactNotebook).toHaveAttribute('data-note-id', noteId, { timeout: 30000 });
      await expect(page.locator('zeppelin-notebook-paragraph')).toHaveCount(0);
      await expect(page.locator('zeppelin-notebook-action-bar')).toHaveCount(1);
      await expect(page.getByTestId('notebook-title')).toHaveCount(0);
      await expect(page.locator('zeppelin-notebook-sidebar')).toHaveCount(0);

      const title = page.getByRole('textbox', { name: 'Notebook title' });
      await title.fill(renamedTitle);
      await title.press('Tab');
      await expect(reactNotebook).toHaveAttribute('data-title', renamedTitle, { timeout: 30000 });

      await page.getByRole('button', { name: 'Add below', exact: true }).click();
      await expect(reactNotebook.getByRole('article')).toHaveCount(2);
      await expect(reactNotebook.getByRole('navigation', { name: 'Notebook outline' }).getByRole('link')).toHaveCount(
        2
      );
      await page.getByRole('button', { name: 'Move down', exact: true }).first().click();
      await expect(reactNotebook.getByRole('article')).toHaveCount(2);
      await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
      await expect(reactNotebook.getByRole('article')).toHaveCount(1);

      await editor.fill(code);
      await expect(editor).toHaveValue(code);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).text).toBe(code);

      await reactNotebook.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(reactNotebook.getByTestId('react-notebook-core-results')).toContainText(marker, {
        timeout: coldInterpreterExecutionTimeout
      });
      await expect(reactNotebook.getByRole('article', { name: 'Paragraph 1' })).toContainText('FINISHED', {
        timeout: 60000
      });
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('runs all paragraphs from the React notebook through the existing socket operation', async ({ page }) => {
    const sentOperations = observeSentOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const marker = `react_run_all_${stamp}`;
    const code = `%python\nprint("${marker}")`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactRunAll_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = reactNotebook.getByRole('textbox', { name: 'Paragraph 1 editor' });
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await editor.fill(code);
      await reactNotebook.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).text).toBe(code);

      await reactNotebook.getByRole('button', { name: 'Run all', exact: true }).click();
      await expect(reactNotebook).toHaveAttribute('data-command-accepted', 'true');
      await expect.poll(() => sentOperations.filter(operation => operation === 'RUN_ALL_PARAGRAPHS').length).toBe(1);
      await expect(reactNotebook.getByTestId('react-notebook-core-results')).toContainText(marker, {
        timeout: coldInterpreterExecutionTimeout
      });
      await expect(reactNotebook.getByRole('article', { name: 'Paragraph 1' })).toContainText('FINISHED', {
        timeout: 60000
      });
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('opens existing notebook extensions and revision controls from React', async ({ page }) => {
    const sentOperations = observeSentOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactExtensions_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(
        page.locator('zeppelin-notebook-action-bar').getByRole('button', { name: 'play-circle' })
      ).toHaveCount(0);
      await expect(reactNotebook.getByRole('button', { name: 'Run all' })).toBeVisible();
      await expect(page.locator('zeppelin-notebook-action-bar').getByRole('button', { name: 'delete' })).toHaveCount(0);
      await expect(
        page.locator('zeppelin-notebook-action-bar').getByRole('button', { name: 'info-circle' })
      ).toHaveCount(0);
      await expect(reactNotebook.getByRole('combobox', { name: 'Notebook look and feel' })).toHaveValue('default');
      await expect(reactNotebook.getByRole('combobox', { name: 'Notebook revision' })).toHaveValue('Head');
      await reactNotebook.getByRole('textbox', { name: 'Paragraph 1 editor' }).fill('%python');
      await reactNotebook.getByRole('textbox', { name: 'Search notebook' }).fill('python');
      await expect(reactNotebook.locator('.editor-search-highlight')).not.toHaveCount(0);

      await reactNotebook.getByRole('button', { name: 'Clone notebook' }).click();
      await expect(page.getByRole('dialog').locator('.ant-modal-title')).toHaveText('Clone Note');
      await page.keyboard.press('Escape');

      await reactNotebook.getByRole('button', { name: 'Move notebook to trash' }).click();
      await expect(page.getByRole('dialog').getByText('Move this note to trash?', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');

      await reactNotebook.getByRole('button', { name: 'Interpreter settings' }).click();
      await expect(page.locator('zeppelin-notebook-interpreter-binding')).toBeVisible();

      await reactNotebook.getByRole('button', { name: 'Permissions' }).click();
      await expect(page.locator('zeppelin-notebook-permissions')).toBeVisible();

      await reactNotebook.getByRole('button', { name: 'Revisions' }).click();
      await expect(page.locator('zeppelin-notebook-revisions-comparator')).toBeVisible();

      await reactNotebook.getByRole('textbox', { name: 'Checkpoint message' }).fill('React route checkpoint');
      await reactNotebook.getByRole('button', { name: 'Checkpoint' }).click();
      await expect.poll(() => sentOperations.filter(operation => operation === 'CHECKPOINT_NOTE').length).toBe(1);
      await expect(reactNotebook.getByRole('combobox', { name: 'Notebook revision' }).locator('option')).toHaveCount(2);
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('persists a React table visualization mode through the existing paragraph contract', async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const code = "%python\nprint('%table name\\tcount\\na\\t12\\nb\\t24')";
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactResultMode_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = page.getByRole('textbox', { name: 'Paragraph 1 editor' });
      await expect(editor).toBeVisible({ timeout: 30000 });
      await editor.fill(code);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await editor.press('Shift+Enter');
      await expect(reactNotebook.getByRole('button', { name: /Line Chart$/ })).toBeVisible({
        timeout: coldInterpreterExecutionTimeout
      });
      await reactNotebook.getByRole('button', { name: /Line Chart$/ }).click();
      await expect
        .poll(async () => (await getPersistedParagraph(page, noteId!, 0)).config?.results?.['0']?.graph?.mode)
        .toBe('lineChart');
    } finally {
      if (noteId) await page.request.delete(`/api/notebook/${noteId}`);
    }
  });

  test('converges paragraph edits between two React notebook adapters', async ({ context, page }) => {
    const peerPage = await context.newPage();
    const sentOperations = observeSentOperations(page);
    const peerSentOperations = observeSentOperations(peerPage);
    const stamp = Date.now();
    const code = `%python\nprint("react_peer_${stamp}")`;
    let noteId: string | undefined;

    try {
      await Promise.all([page.goto('/#/'), peerPage.goto('/#/')]);
      await Promise.all([waitForZeppelinReady(page), waitForZeppelinReady(peerPage)]);
      await Promise.all([performLoginIfRequired(page), performLoginIfRequired(peerPage)]);

      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactPeer_${stamp}`);
      await Promise.all([
        page.goto(`/#/notebook/${noteId}?reactNotebook=true`),
        peerPage.goto(`/#/notebook/${noteId}?reactNotebook=true`)
      ]);

      const editor = page.getByRole('textbox', { name: 'Paragraph 1 editor' });
      const peerEditor = peerPage.getByRole('textbox', { name: 'Paragraph 1 editor' });
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(peerEditor).toBeVisible({ timeout: 30000 });

      await editor.fill(code);
      await expect
        .poll(() => sentOperations.filter(operation => operation === 'PATCH_PARAGRAPH').length)
        .toBeGreaterThan(0);
      await expect(peerEditor).toHaveValue(code, { timeout: 30000 });
      expect(peerSentOperations.filter(operation => operation === 'PATCH_PARAGRAPH')).toEqual([]);
    } finally {
      await peerPage.close();
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('converges React paragraph edits between distinct authenticated users', async ({ browser, page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    const ticket = await page.request.get('/api/security/ticket');
    const principal = ((await ticket.json()) as { body?: { principal?: string } }).body?.principal;
    test.skip(principal !== 'user1', 'Requires the local user1/user2 Shiro fixture.');

    const user2Context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const user2Page = await user2Context.newPage();
    const stamp = Date.now();
    const code = `%python\nprint("cross_principal_${stamp}")`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CrossPrincipal_${stamp}`);
      await grantNotebookAccess(page, noteId, 'user2');
      await loginAs(user2Page, 'user2', 'password3');

      await Promise.all([
        page.goto(`/#/notebook/${noteId}?reactNotebook=true`),
        user2Page.goto(`/#/notebook/${noteId}?reactNotebook=true`)
      ]);

      const user1Editor = page.getByRole('textbox', { name: 'Paragraph 1 editor' });
      const user2Editor = user2Page.getByRole('textbox', { name: 'Paragraph 1 editor' });
      await expect(user1Editor).toBeVisible({ timeout: 30000 });
      await expect(user2Editor).toBeVisible({ timeout: 30000 });

      await user2Editor.fill(code);
      await expect(user1Editor).toHaveValue(code, { timeout: 30000 });
    } finally {
      await user2Context.close();
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('disables React mutations for an authenticated reader', async ({ browser, page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    const ticket = await page.request.get('/api/security/ticket');
    const principal = ((await ticket.json()) as { body?: { principal?: string } }).body?.principal;
    test.skip(principal !== 'user1', 'Requires the local user1/user2 Shiro fixture.');

    const user2Context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const user2Page = await user2Context.newPage();
    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/Reader_${stamp}`);
      const response = await page.request.put(`/api/notebook/${noteId}/permissions`, {
        data: {
          owners: ['user1'],
          readers: ['user1', 'user2'],
          writers: ['user1'],
          runners: ['user1']
        }
      });
      expect(
        response.ok(),
        `Set reader permissions failed: ${response.status()} ${await response.text()}`
      ).toBeTruthy();
      await loginAs(user2Page, 'user2', 'password3');
      const permissions = await user2Page.request.get(`/api/notebook/${noteId}/permissions`);
      expect(
        permissions.ok(),
        `Reader permission lookup failed: ${permissions.status()} ${await permissions.text()}`
      ).toBeTruthy();
      expect((await permissions.json()).body).toMatchObject({
        owners: ['user1'],
        readers: ['user1', 'user2'],
        writers: ['user1'],
        runners: ['user1']
      });
      await user2Page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      await expect(user2Page.getByRole('textbox', { name: 'Notebook title' })).toBeDisabled({ timeout: 30000 });
      await expect(user2Page.getByRole('button', { name: 'Add below', exact: true })).toBeDisabled();
      await expect(user2Page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
      await expect(user2Page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    } finally {
      await user2Context.close();
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('allows an authenticated runner to execute without edit capability', async ({ browser, page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    const ticket = await page.request.get('/api/security/ticket');
    const principal = ((await ticket.json()) as { body?: { principal?: string } }).body?.principal;
    test.skip(principal !== 'user1', 'Requires the local user1/user2 Shiro fixture.');

    const user2Context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const user2Page = await user2Context.newPage();
    const stamp = Date.now();
    const marker = `runner_${stamp}`;
    const code = `%python\nprint("${marker}")`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/Runner_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const ownerNotebook = page.getByTestId('notebook-core-react-adapter');
      await expect(ownerNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await ownerNotebook.getByRole('textbox', { name: 'Paragraph 1 editor' }).fill(code);
      await ownerNotebook.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).text).toBe(code);

      const response = await page.request.put(`/api/notebook/${noteId}/permissions`, {
        data: {
          owners: ['user1'],
          readers: ['user1', 'user2'],
          writers: ['user1'],
          runners: ['user1', 'user2']
        }
      });
      expect(
        response.ok(),
        `Set runner permissions failed: ${response.status()} ${await response.text()}`
      ).toBeTruthy();
      await loginAs(user2Page, 'user2', 'password3');
      await user2Page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      const runnerNotebook = user2Page.getByTestId('notebook-core-react-adapter');
      await expect(runnerNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(runnerNotebook.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await expect(runnerNotebook.getByRole('button', { name: 'Add below', exact: true })).toBeDisabled();
      await expect(runnerNotebook.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();

      await runnerNotebook.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(runnerNotebook.getByRole('article', { name: 'Paragraph 1' })).toContainText('FINISHED', {
        timeout: 60000
      });
      await expect(runnerNotebook.getByTestId('react-notebook-core-results')).toContainText(marker, { timeout: 30000 });
    } finally {
      await user2Context.close();
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
        page.goto(`/#/notebook/${noteId}?coreProof=true&reactNotebook=false`),
        peerPage.goto(`/#/notebook/${noteId}?coreProof=true&reactNotebook=false`)
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
      await page.goto(`/#/notebook/${noteId}?coreProof=true&reactFooter=true&reactNotebook=false`);

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
