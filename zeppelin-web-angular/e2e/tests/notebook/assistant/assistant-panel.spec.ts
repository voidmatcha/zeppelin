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

import { expect, test } from '@playwright/test';
import { FakeAssistantBackend, NotebookAssistantPage } from '../../../models/notebook-assistant-page';
import { NotebookSidebarPage } from '../../../models/notebook-sidebar-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  performLoginIfRequired,
  waitForNotebookLinks,
  waitForZeppelinReady
} from '../../../utils';

const QUESTION = 'What does this notebook do?';

test.describe('Notebook Assistant Panel', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_ASSISTANT_HOST);

  let noteId: string;
  let assistant: NotebookAssistantPage;
  let backend: FakeAssistantBackend;

  test.beforeEach(async ({ page }) => {
    assistant = new NotebookAssistantPage(page);
    // Installed before the first page load: routeWebSocket only sees sockets opened after it.
    backend = new FakeAssistantBackend();
    await backend.install(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    await waitForNotebookLinks(page);
    ({ noteId } = await createTestNotebook(page));
  });

  test('stays hidden without the reactAssistant flag', async ({ page }) => {
    await test.step('When I open the notebook without the flag', async () => {
      await page.goto(`/#/notebook/${noteId}`);
      await waitForZeppelinReady(page);
    });

    await test.step('Then no assistant entry is shown', async () => {
      await expect(new NotebookSidebarPage(page).sidebarContainer).toBeVisible();
      await expect(page.locator('zeppelin-assistant-host [zeppelin-react-mount]')).toHaveCount(0);
      await expect(assistant.toggleButton).toHaveCount(0);
    });
  });

  test('streams an answer into a conversation named after the first question', async ({ page }) => {
    backend.reply = () => [
      { type: 'run.started', payload: { runId: 'run-1' } },
      { type: 'message.delta', payload: { messageId: 'answer-1', delta: 'It loads ' } },
      { type: 'message.delta', payload: { messageId: 'answer-1', delta: 'sales data.' } },
      { type: 'message.done', payload: { messageId: 'answer-1', content: 'It loads sales data and charts it.' } },
      { type: 'run.completed', payload: { runId: 'run-1' } }
    ];

    await test.step('Given the notebook is open with the reactAssistant flag', async () => {
      await page.goto(`/#/notebook/${noteId}?reactAssistant=true`);
      await waitForZeppelinReady(page);
    });

    await test.step('When I open the panel and ask a question', async () => {
      await assistant.open();
      await expect(assistant.messages.getByText('How can I help?', { exact: true })).toBeVisible();
      await assistant.ask(QUESTION);
    });

    await test.step('Then the answer appears and the conversation takes the question as its title', async () => {
      await expect(assistant.messages.getByText('It loads sales data and charts it.', { exact: true })).toBeVisible();
      await expect(assistant.messages.getByText(QUESTION, { exact: true })).toBeVisible();
      await expect(assistant.threadSelect.locator('option:checked')).toHaveText(QUESTION);
      await expect(assistant.messageInput).toBeEnabled();
      expect(backend.sentMessages).toEqual([{ noteId, conversationId: 'e2e-conversation-1', content: QUESTION }]);
    });

    await test.step('When I delete the conversation', async () => {
      await assistant.deleteButton(QUESTION).click();
    });

    await test.step('Then the panel is back to a new conversation', async () => {
      await expect(assistant.threadSelect.locator('option:checked')).toHaveText('New conversation');
      await expect(assistant.messages.getByText('How can I help?', { exact: true })).toBeVisible();
      expect(backend.deletedIds).toEqual(['e2e-conversation-1']);
    });
  });

  test('explains a rejected first question and keeps it for another try', async ({ page }) => {
    backend.reply = () => [{ type: 'run.failed', payload: { runId: 'run-1', error: { status: 503 } } }];

    await test.step('Given the notebook is open with the reactAssistant flag', async () => {
      await page.goto(`/#/notebook/${noteId}?reactAssistant=true`);
      await waitForZeppelinReady(page);
    });

    await test.step('When I ask a question the server rejects', async () => {
      await assistant.open();
      await assistant.ask(QUESTION);
    });

    await test.step('Then the panel explains it and the question stays in the composer', async () => {
      await expect(
        assistant.panel.getByText(
          'The assistant is not configured on this server. Ask an administrator to enable it.',
          {
            exact: true
          }
        )
      ).toBeVisible();
      await expect(assistant.messageInput).toHaveValue(QUESTION);
      await expect.poll(() => backend.deletedIds).toEqual(['e2e-conversation-1']);
    });
  });
});
