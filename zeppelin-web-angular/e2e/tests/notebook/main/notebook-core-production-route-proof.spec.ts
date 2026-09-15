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
    data: { notePath, defaultInterpreterGroup: 'sh', addingEmptyParagraph: true }
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
  settings?: { params?: Record<string, unknown> };
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

const replaceMonacoText = async (page: Page, editor: Locator, text: string): Promise<void> => {
  await editor.focus();
  const isMacintosh = await page.evaluate(() => navigator.userAgent.includes('Macintosh'));
  await page.keyboard.press(isMacintosh ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(text);
};

const expectMonacoText = async (editor: Locator, text: string, timeout = 5000): Promise<void> => {
  await expect
    .poll(
      () =>
        editor
          .locator('xpath=ancestor::div[contains(@class, "zeppelin-react-notebook-editor")]')
          .evaluate(
            element =>
              (element as HTMLElement & { __zeppelinNotebookEditorValue?: string }).__zeppelinNotebookEditorValue ?? ''
          ),
      { timeout }
    )
    .toBe(text);
};

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

type SentOperation = Readonly<{ op: string; msgId?: string; data: unknown }>;

const observeSentMessages = (page: Page): SentOperation[] => {
  const messages: SentOperation[] = [];
  page.on('websocket', webSocket => {
    webSocket.on('framesent', event => {
      if (typeof event.payload !== 'string') return;
      try {
        const message = JSON.parse(event.payload) as { op?: unknown; msgId?: unknown; data?: unknown };
        if (typeof message.op === 'string') {
          messages.push({
            op: message.op,
            msgId: typeof message.msgId === 'string' ? message.msgId : undefined,
            data: message.data
          });
        }
      } catch {
        // Non-JSON development-server frames are unrelated to Zeppelin operations.
      }
    });
  });
  return messages;
};

type ReceivedOperation = Readonly<{ op: string; msgId?: string; data: unknown }>;

const observeReceivedOperations = (page: Page): ReceivedOperation[] => {
  const operations: ReceivedOperation[] = [];
  page.on('websocket', webSocket => {
    webSocket.on('framereceived', event => {
      if (typeof event.payload !== 'string') {
        return;
      }
      try {
        const message = JSON.parse(event.payload) as { op?: unknown; msgId?: unknown; data?: unknown };
        if (typeof message.op === 'string') {
          operations.push({
            op: message.op,
            msgId: typeof message.msgId === 'string' ? message.msgId : undefined,
            data: message.data
          });
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
  // JUSTIFIED: the production-route cases share the server's default interpreter process;
  // parallel note cleanup can terminate an execution that another case is still observing.
  test.describe.configure({ mode: 'default' });
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);

  test('keeps the React notebook theme synchronized with the Angular host', async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CoreTheme_${stamp}`);
      await page.goto(`/#/notebook/${noteId}`);

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

  test('falls back to the Angular notebook when the React remote fails to load', async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CoreFallback_${stamp}`);
      await page.route('**/remoteEntry.js', route => route.abort());

      const remoteRequested = page.waitForRequest('**/remoteEntry.js');
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      await remoteRequested;

      await expect(page.locator('zeppelin-notebook-paragraph')).toHaveCount(1, { timeout: 15000 });
      await expect(page.getByTestId('notebook-core-react-adapter')).toHaveCount(0);
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

        await keyboardPage.setCodeEditorContent('%sh\necho "Core proof first paragraph"', 0);
        await keyboardPage.setCodeEditorContent('%sh\necho "Core proof second paragraph"', 1);

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
    const markerFirst = `${marker}_first`;
    const markerSecond = `${marker}_second`;
    const code = `%sh\necho "${markerFirst}"\nsleep 0.2\necho "${markerSecond}"`;
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
      await expectMonacoText(reactAdapter.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true }), code);

      const reactRunButton = reactAdapter.getByRole('button', { name: 'Run', exact: true });
      await expect(reactRunButton).toBeEnabled();
      await reactRunButton.click();

      await expect(reactAdapter).toHaveAttribute('data-command-accepted', 'true');
      await expect.poll(() => sentOperations.filter(operation => operation === 'RUN_PARAGRAPH').length).toBe(1);
      await expect(paragraphResult).toContainText(markerFirst, { timeout: 30000 });
      await expect(paragraphResult).toContainText(markerSecond, { timeout: 30000 });
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
      await expect(proof).toHaveAttribute('data-paragraph-results', new RegExp(markerFirst), { timeout: 30000 });
      await expect(reactAdapter.getByTestId('react-notebook-core-results')).toContainText(markerFirst, {
        timeout: 30000
      });
      await expect(reactAdapter.getByTestId('react-notebook-core-results')).toContainText(markerSecond, {
        timeout: 30000
      });
      await expect(keyboardPage.getParagraphStatus(0)).toHaveText('FINISHED', { timeout: 60000 });
      await expect(paragraphResult).toContainText(markerSecond, { timeout: 30000 });
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
      await expect(paragraphResult).toContainText(markerSecond, { timeout: 30000 });
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
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
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
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await context.setOffline(false);

      await expect
        .poll(() => receivedOperations.filter(operation => operation.op === 'NOTE').length, { timeout: 30000 })
        .toBeGreaterThan(noteEventsBeforeOffline);
      await expect(reactNotebook).toHaveAttribute('data-note-id', noteId);
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(reactNotebook.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true })).toBeVisible();
    } finally {
      await context.setOffline(false);
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('retains an unsaved React draft when switching to the Angular notebook', async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const draftMarker = `retained_draft_${stamp}`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactFallbackDraft_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = reactNotebook.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await replaceMonacoText(page, editor, `%sh\necho "${draftMarker}"`);

      await page.evaluate(id => {
        window.location.hash = `#/notebook/${id}?reactNotebook=false`;
      }, noteId);

      await expect(reactNotebook).toHaveCount(0);
      await expect(page.locator('zeppelin-notebook-paragraph .monaco-editor .view-lines')).toContainText(draftMarker, {
        timeout: 30000
      });
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('recovers active React output in a new browser connection from an authoritative snapshot', async ({
    context,
    page
  }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const marker = `react_output_recovery_${stamp}`;
    const markerFirst = `${marker}_first`;
    const markerSecond = `${marker}_second`;
    const code = `%sh\necho "${markerFirst}"\ni=0\nwhile [ "$i" -lt 6 ]; do sleep 5; echo heartbeat_$i; i=$((i + 1)); done\necho "${markerSecond}"`;
    let noteId: string | undefined;
    let recoveryPage: Page | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactOutputRecovery_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = page.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      const paragraphResult = reactNotebook.getByTestId('react-notebook-core-results');
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      await replaceMonacoText(page, editor, code);
      const saveButton = page.getByRole('button', { name: 'Save', exact: true });
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect.poll(async () => (await getPersistedParagraph(page, noteId!, 0)).text).toBe(code);

      await reactNotebook.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(paragraphResult).toContainText(markerFirst, { timeout: coldInterpreterExecutionTimeout });

      recoveryPage = await context.newPage();
      const recoverySentOperations = observeSentOperations(recoveryPage);
      const recoveryReceivedOperations = observeReceivedOperations(recoveryPage);
      await recoveryPage.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const recoveredNotebook = recoveryPage.getByTestId('notebook-core-react-adapter');
      const recoveredResult = recoveredNotebook.getByTestId('react-notebook-core-results');
      await expect(recoveredNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      await expect
        .poll(() => recoverySentOperations.filter(operation => operation === 'GET_PARAGRAPH_OUTPUT').length, {
          timeout: 30000
        })
        .toBeGreaterThan(0);
      await expect
        .poll(
          () => recoveryReceivedOperations.filter(operation => operation.op === 'PARAGRAPH_OUTPUT_SNAPSHOT').length,
          { timeout: 30000 }
        )
        .toBeGreaterThan(0);
      const snapshot = recoveryReceivedOperations.find(
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
      await expect(recoveredResult).toContainText(markerSecond, { timeout: coldInterpreterExecutionTimeout });
    } finally {
      await recoveryPage?.close();
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('renders and operates the editable notebook body in React', async ({ page }) => {
    const sentOperations = observeSentOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    const marker = `react_notebook_${stamp}`;
    const code = `%sh\necho "${marker}"`;
    const renamedTitle = `ReactNotebookRenamed_${stamp}`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactNotebook_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = page.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      await expect(reactNotebook).toHaveAttribute('data-note-id', noteId, { timeout: 30000 });
      await expect
        .poll(() => sentOperations.filter(operation => operation === 'EDITOR_SETTING').length)
        .toBeGreaterThan(0);
      await expect(page.locator('zeppelin-notebook-paragraph')).toHaveCount(0);
      await expect(page.locator('zeppelin-notebook-action-bar')).toHaveCount(1);
      await expect(page.getByTestId('notebook-title')).toHaveCount(0);
      await expect(page.locator('zeppelin-notebook-sidebar')).toHaveCount(0);

      const title = page.getByRole('textbox', { name: 'Notebook title', exact: true });
      await title.fill(renamedTitle);
      await title.press('Tab');
      await expect(reactNotebook).toHaveAttribute('data-title', renamedTitle, { timeout: 30000 });

      await page.getByRole('button', { name: 'Add below', exact: true }).click();
      await expect(reactNotebook.getByRole('article')).toHaveCount(2);
      await expect(reactNotebook.getByRole('navigation', { name: 'Notebook outline' }).getByRole('link')).toHaveCount(
        2
      );
      const paragraphItems = reactNotebook.locator('ol[aria-label="Notebook paragraphs"] > li');
      const paragraphOrderBeforeMove = await paragraphItems.evaluateAll(items =>
        items.map(item => item.getAttribute('data-testid'))
      );
      await reactNotebook
        .getByRole('article', { name: 'Paragraph 1', exact: true })
        .getByRole('button', { name: 'Move down', exact: true })
        .click();
      await expect
        .poll(() => paragraphItems.evaluateAll(items => items.map(item => item.getAttribute('data-testid'))))
        .toEqual([...paragraphOrderBeforeMove].reverse());
      await reactNotebook
        .getByRole('article', { name: 'Paragraph 1', exact: true })
        .getByRole('button', { name: 'Delete', exact: true })
        .click();
      const deleteConfirmation = page.getByRole('dialog');
      await expect(deleteConfirmation).toContainText('Do you want to delete this paragraph?');
      await deleteConfirmation.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(reactNotebook.getByRole('article')).toHaveCount(1);

      await replaceMonacoText(page, editor, code);
      await expectMonacoText(editor, code);
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
    const code = `%sh\necho "${marker}"`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactRunAll_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      const editor = reactNotebook.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await replaceMonacoText(page, editor, code);
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

  test('opens existing notebook extensions from React', async ({ page }) => {
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
      await expect(reactNotebook.getByRole('button', { name: 'Run all', exact: true })).toBeVisible();
      await expect(page.locator('zeppelin-notebook-action-bar').getByRole('button', { name: 'delete' })).toHaveCount(0);
      await expect(
        page.locator('zeppelin-notebook-action-bar').getByRole('button', { name: 'info-circle' })
      ).toHaveCount(0);
      await expect(reactNotebook.getByRole('combobox', { name: 'Notebook look and feel' })).toHaveValue('default');
      await replaceMonacoText(
        page,
        reactNotebook.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true }),
        '%python'
      );
      await reactNotebook.getByRole('textbox', { name: 'Search notebook' }).fill('python');
      await expect(reactNotebook.locator('.editor-search-highlight')).not.toHaveCount(0);

      await reactNotebook.getByRole('button', { name: 'Clone notebook' }).click();
      await expect(page.getByRole('dialog').locator('.ant-modal-title')).toHaveText('Clone Note');
      await page.keyboard.press('Escape');

      await reactNotebook.getByRole('button', { name: 'Move notebook to trash' }).click();
      await expect(page.getByRole('dialog').getByText('Move this note to trash?', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');

      await reactNotebook.getByRole('button', { name: 'Interpreter settings' }).click();
      await expect(reactNotebook.getByRole('region', { name: 'Notebook interpreter bindings' })).toBeVisible();
      await expect(page.locator('zeppelin-notebook-interpreter-binding')).toHaveCount(0);

      await reactNotebook.getByRole('button', { name: 'Permissions' }).click();
      await expect(reactNotebook.getByRole('region', { name: 'Notebook permissions' })).toBeVisible();
      await expect(page.locator('zeppelin-notebook-permissions')).toHaveCount(0);
    } finally {
      if (noteId) {
        await page.request.delete(`/api/notebook/${noteId}`);
      }
    }
  });

  test('creates a notebook checkpoint from React with Git storage', async ({ page }) => {
    test.skip(process.env.ZEPPELIN_E2E_REQUIRE_REVISION !== 'true', 'Requires GitNotebookRepo revision support.');
    const sentMessages = observeSentMessages(page);
    const receivedOperations = observeReceivedOperations(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/ReactCheckpoint_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);

      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await expect(reactNotebook.getByRole('combobox', { name: 'Notebook revision' })).toHaveValue('Head');

      await reactNotebook.getByRole('textbox', { name: 'Checkpoint message' }).fill('React route checkpoint');
      await reactNotebook.getByRole('button', { name: 'Checkpoint' }).click();

      await expect.poll(() => sentMessages.filter(message => message.op === 'CHECKPOINT_NOTE').length).toBe(1);
      const checkpointRequest = sentMessages.find(message => message.op === 'CHECKPOINT_NOTE');
      expect(checkpointRequest?.msgId).toBeTruthy();
      await expect
        .poll(() => receivedOperations.filter(operation => operation.op === 'LIST_REVISION_HISTORY'), {
          timeout: 60000
        })
        .toContainEqual(expect.objectContaining({ msgId: checkpointRequest?.msgId }));
      await expect(reactNotebook.getByRole('combobox', { name: 'Notebook revision' }).locator('option')).toHaveCount(
        2,
        {
          timeout: 15000
        }
      );
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
    let noteId: string | undefined;

    try {
      const imported = await page.request.post('/api/notebook/import', {
        params: { notePath: `/E2E_TEST_FOLDER/ReactResultMode_${stamp}` },
        data: {
          name: `ReactResultMode_${stamp}`,
          paragraphs: [
            {
              id: `paragraph_result_mode_${stamp}`,
              title: 'Table result',
              text: '%sh\necho table-result',
              user: 'anonymous',
              status: 'FINISHED',
              config: {
                colWidth: 12,
                fontSize: 9,
                enabled: true,
                editorHide: false,
                tableHide: false,
                title: false,
                editorSetting: { language: 'sh', editOnDblClick: false }
              },
              settings: { params: {}, forms: {} },
              apps: [],
              runtimeInfos: {},
              results: { code: 'SUCCESS', msg: [{ type: 'TABLE', data: 'name\tcount\na\t12\nb\t24' }] }
            }
          ]
        }
      });
      expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBeTruthy();
      noteId = (await imported.json()).body as string;
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      await expect(reactNotebook.getByTestId('react-notebook-core-result')).toHaveAttribute(
        'data-result-type',
        'TABLE',
        { timeout: 30000 }
      );
      const modes = [
        { icon: 'bar-chart', mode: 'multiBarChart', renderer: 'zeppelin-bar-chart-visualization canvas' },
        { icon: 'pie-chart', mode: 'pieChart', renderer: 'zeppelin-pie-chart-visualization canvas' },
        { icon: 'line-chart', mode: 'lineChart', renderer: 'zeppelin-line-chart-visualization canvas' },
        { icon: 'area-chart', mode: 'stackedAreaChart', renderer: 'zeppelin-area-chart-visualization canvas' },
        { icon: 'dot-chart', mode: 'scatterChart', renderer: 'zeppelin-scatter-chart-visualization canvas' }
      ] as const;

      for (const { icon, mode, renderer } of modes) {
        const modeControl = reactNotebook.getByRole('img', { name: icon, exact: true });
        await expect(modeControl).toBeVisible({ timeout: coldInterpreterExecutionTimeout });
        await modeControl.click();
        await expect
          .poll(async () => (await getPersistedParagraph(page, noteId!, 0)).config?.results?.['0']?.graph?.mode)
          .toBe(mode);
        await expect(reactNotebook.locator(renderer)).toBeVisible({ timeout: 15000 });
      }
    } finally {
      if (noteId) await page.request.delete(`/api/notebook/${noteId}`);
    }
  });

  test('runs a React dynamic form selection once with the selected parameter', async ({ page }) => {
    const sentMessages = observeSentMessages(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    const stamp = Date.now();
    let noteId: string | undefined;

    try {
      const imported = await page.request.post('/api/notebook/import', {
        params: { notePath: `/E2E_TEST_FOLDER/ReactDynamicForm_${stamp}` },
        data: {
          name: `ReactDynamicForm_${stamp}`,
          paragraphs: [
            {
              id: `paragraph_dynamic_form_${stamp}`,
              title: 'Dynamic form',
              text: '%sh\necho dynamic-form',
              user: 'anonymous',
              status: 'READY',
              config: {
                colWidth: 12,
                fontSize: 9,
                enabled: true,
                editorHide: false,
                tableHide: false,
                title: false,
                runOnSelectionChange: true,
                editorSetting: { language: 'sh', editOnDblClick: false, completionSupport: false }
              },
              settings: {
                params: { country: 'kr' },
                forms: {
                  country: {
                    name: 'country',
                    displayName: 'Country',
                    type: 'Select',
                    hidden: false,
                    defaultValue: 'kr',
                    options: [
                      { value: 'kr', displayName: 'Korea' },
                      { value: 'us', displayName: 'United States' }
                    ]
                  }
                }
              },
              apps: [],
              runtimeInfos: {},
              results: { code: 'SUCCESS', msg: [] }
            }
          ]
        }
      });
      expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBeTruthy();
      noteId = (await imported.json()).body as string;

      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const reactNotebook = page.getByTestId('notebook-core-react-adapter');
      await expect(reactNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });

      const country = reactNotebook.getByRole('combobox', { name: 'Country' });
      await expect(country).toHaveValue('0');
      await country.selectOption({ label: 'United States' });

      await expect.poll(() => sentMessages.filter(message => message.op === 'RUN_PARAGRAPH').length).toBe(1);
      expect(sentMessages.find(message => message.op === 'RUN_PARAGRAPH')?.data).toMatchObject({
        id: `paragraph_dynamic_form_${stamp}`,
        params: { country: 'us' }
      });
      await expect
        .poll(async () => (await getPersistedParagraph(page, noteId!, 0)).settings?.params?.country)
        .toBe('us');
    } finally {
      if (noteId) await page.request.delete(`/api/notebook/${noteId}`);
    }
  });

  test('converges paragraph edits between two React notebook adapters', async ({ context, page }) => {
    const peerPage = await context.newPage();
    const sentOperations = observeSentOperations(page);
    const peerSentOperations = observeSentOperations(peerPage);
    const stamp = Date.now();
    const code = `%sh\necho "react_peer_${stamp}"`;
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

      const editor = page.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      const peerEditor = peerPage.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(peerEditor).toBeVisible({ timeout: 30000 });
      await expect(page.getByLabel('Collaborators')).toHaveText('Collaborators: 1');

      await replaceMonacoText(page, editor, code);
      await expect
        .poll(() => sentOperations.filter(operation => operation === 'PATCH_PARAGRAPH').length)
        .toBeGreaterThan(0);
      await expectMonacoText(peerEditor, code, 30000);
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
    const code = `%sh\necho "cross_principal_${stamp}"`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/CrossPrincipal_${stamp}`);
      await grantNotebookAccess(page, noteId, 'user2');
      await loginAs(user2Page, 'user2', 'password3');

      await Promise.all([
        page.goto(`/#/notebook/${noteId}?reactNotebook=true`),
        user2Page.goto(`/#/notebook/${noteId}?reactNotebook=true`)
      ]);

      const user1Editor = page.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      const user2Editor = user2Page.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true });
      await expect(user1Editor).toBeVisible({ timeout: 30000 });
      await expect(user2Editor).toBeVisible({ timeout: 30000 });

      await replaceMonacoText(user2Page, user2Editor, code);
      await expectMonacoText(user1Editor, code, 30000);
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
    const code = `%sh\necho "${marker}"`;
    let noteId: string | undefined;

    try {
      noteId = await createNote(page, `E2E_TEST_FOLDER/Runner_${stamp}`);
      await page.goto(`/#/notebook/${noteId}?reactNotebook=true`);
      const ownerNotebook = page.getByTestId('notebook-core-react-adapter');
      await expect(ownerNotebook).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
      await replaceMonacoText(
        page,
        ownerNotebook.getByRole('textbox', { name: 'Paragraph 1 editor', exact: true }),
        code
      );
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
    const code = `%sh\necho "${marker}"`;
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
      await expect(page.getByLabel('Collaborators')).toHaveText('Collaborators: 1');

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
    const code = '%sh\nsleep 30\necho "must not finish before cancellation"';
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
