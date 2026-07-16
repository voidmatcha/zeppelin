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
import { CollaborationPage } from 'e2e/models/collaboration-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  performLoginIfRequired,
  skipWhenAuthenticationIsStillRequired,
  waitForNotebookLinks,
  waitForZeppelinReady
} from '../../../utils';

test.describe('Collaborative mode', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);

  test('syncs paragraph editor changes between two notebook viewers', async ({ page, browser }) => {
    const syncText = `collaborative_mode_text_${Date.now()}`;
    const collaborationPage = new CollaborationPage(page);

    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    await skipWhenAuthenticationIsStillRequired(page);
    await waitForNotebookLinks(page);

    const { noteId } = await createTestNotebook(page);
    await collaborationPage.openNotebook(noteId);
    await collaborationPage.switchToCollaborationModeIfAvailable();

    const collaboratorContext = await browser.newContext({ storageState: await page.context().storageState() });
    const collaboratorPage = await collaboratorContext.newPage();
    const collaboratorView = new CollaborationPage(collaboratorPage);

    try {
      await collaboratorPage.goto('/#/');
      await waitForZeppelinReady(collaboratorPage);
      await performLoginIfRequired(collaboratorPage);
      await skipWhenAuthenticationIsStillRequired(collaboratorPage);
      await collaboratorView.openNotebook(noteId);

      await expect(collaborationPage.editor).toBeVisible({ timeout: 15000 });
      await expect(collaboratorView.editor).toBeVisible({ timeout: 15000 });

      await collaborationPage.typeInEditor(syncText);

      await expect(collaborationPage.editorText).toContainText(syncText, { timeout: 15000 });
      await expect(collaboratorView.editorText).toContainText(syncText, { timeout: 30000 });
    } finally {
      await collaboratorContext.close();
    }
  });
});
