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
import { NotebookAssistantPage } from '../../../models/notebook-assistant-page';
import { FakeAssistantBackend } from '../../../models/notebook-assistant-page.util';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  performLoginIfRequired,
  waitForNotebookLinks,
  waitForZeppelinReady
} from '../../../utils';

// The approval protocol is proposed, not yet in the server: the fake backend plays it so the UI can be checked.
const EDITED_TEXT = '%md\n# Edited by the assistant';

test.describe('Assistant approvals (proposed protocol)', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_ASSISTANT_PARAGRAPH_PROPOSAL);

  let noteId: string;
  let paragraphId: string;
  let assistant: NotebookAssistantPage;
  let backend: FakeAssistantBackend;

  test.beforeEach(async ({ page }) => {
    assistant = new NotebookAssistantPage(page);
    backend = new FakeAssistantBackend();
    await backend.install(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    await waitForNotebookLinks(page);
    ({ noteId, paragraphId } = await createTestNotebook(page));
    backend.reply = () => [
      { type: 'run.started', payload: { runId: 'run-1' } },
      {
        type: 'tool_call.approval_requested',
        payload: {
          runId: 'run-1',
          toolCallId: 'edit-1',
          name: 'update_paragraph',
          arguments: { paragraphId, text: EDITED_TEXT }
        }
      }
    ];
    backend.afterDecision = ({ decision }) => [
      { type: 'tool_call.done', payload: { toolCallId: 'edit-1' } },
      {
        type: 'message.done',
        payload: { messageId: 'answer-1', content: decision === 'allow' ? 'Updated the paragraph.' : 'Left it as is.' }
      },
      { type: 'run.completed', payload: { runId: 'run-1' } }
    ];
    await page.goto(`/#/notebook/${noteId}?reactAssistant=true`);
    await waitForZeppelinReady(page);
  });

  test('shows a proposed edit as a diff in its paragraph and sends Allow from there', async () => {
    await test.step('When I ask for a change', async () => {
      await assistant.open();
      await assistant.ask('Add a title');
    });

    await test.step('Then the edit waits in the panel and as an inline diff in the paragraph', async () => {
      await expect(assistant.panel.getByText('Waiting for your approval…', { exact: true })).toBeVisible();
      await expect(assistant.panel.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
      await expect(assistant.proposal(paragraphId)).toBeVisible();
      await expect(assistant.proposal(paragraphId).getByText(/line(s)? removed, \d+ lines? added/)).toBeVisible();
      await expect(assistant.proposal(paragraphId).getByText('# Edited by the assistant')).toBeVisible();
    });

    await test.step('When I allow it in the paragraph', async () => {
      await assistant.proposal(paragraphId).getByRole('button', { name: 'Allow', exact: true }).click();
    });

    await test.step('Then one decision is sent, the diff closes and the panel records it', async () => {
      await expect(assistant.proposal(paragraphId)).toHaveCount(0);
      await expect(assistant.panel.getByText('Allowed', { exact: true })).toBeVisible();
      await expect(assistant.messages.getByText('Updated the paragraph.', { exact: true })).toBeVisible();
      expect(backend.decisions).toEqual([
        { noteId, conversationId: 'e2e-conversation-1', toolCallId: 'edit-1', decision: 'allow' }
      ]);
    });
  });

  test('skips from the panel and removes the diff from the paragraph', async () => {
    await test.step('When I ask for a change and skip it in the panel', async () => {
      await assistant.open();
      await assistant.ask('Add a title');
      await expect(assistant.proposal(paragraphId)).toBeVisible();
      await assistant.panel.getByRole('button', { name: 'Skip', exact: true }).click();
    });

    await test.step('Then the diff closes and the assistant is told', async () => {
      await expect(assistant.proposal(paragraphId)).toHaveCount(0);
      await expect(assistant.panel.getByText('Skipped. The assistant was told not to do this.')).toBeVisible();
      await expect(assistant.messages.getByText('Left it as is.', { exact: true })).toBeVisible();
      expect(backend.decisions.map(item => item.decision)).toEqual(['skip']);
    });
  });
});
