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

import { expect, Page, test } from '@playwright/test';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  performLoginIfRequired,
  waitForNotebookLinks,
  waitForZeppelinReady
} from '../../../utils';

const paragraph = (page: Page) => page.locator('zeppelin-notebook-paragraph').first();
const skipWhenAuthenticationIsStillRequired = async (page: Page): Promise<void> => {
  const loginStillVisible = await page
    .locator('zeppelin-login')
    .isVisible()
    .catch(() => false);
  test.skip(loginStillVisible, 'Authentication is enabled but no E2E test credentials are configured');
};

const editor = (page: Page) => paragraph(page).locator('.monaco-editor').first();
const editorText = (page: Page) => paragraph(page).locator('.view-lines').first();

const openNotebook = async (page: Page, noteId: string): Promise<void> => {
  await page.goto(`/#/notebook/${noteId}`);
  await waitForZeppelinReady(page);
  await expect(paragraph(page)).toBeVisible({ timeout: 15000 });
};

const switchToCollaborationModeIfAvailable = async (page: Page): Promise<void> => {
  const collaborationButton = page.getByRole('button', { name: 'Collaboration' });

  if (await collaborationButton.isVisible().catch(() => false)) {
    await collaborationButton.click();
    await expect(page.getByRole('button', { name: 'Personalized' })).toBeVisible({ timeout: 15000 });
  }
};

test.describe('Collaborative mode', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);

  test('syncs paragraph editor changes between two notebook viewers', async ({ page, browser }) => {
    const syncText = `collaborative_mode_text_${Date.now()}`;

    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    await skipWhenAuthenticationIsStillRequired(page);
    await waitForNotebookLinks(page);

    const { noteId } = await createTestNotebook(page);
    await openNotebook(page, noteId);
    await switchToCollaborationModeIfAvailable(page);

    const collaboratorContext = await browser.newContext({ storageState: await page.context().storageState() });
    const collaboratorPage = await collaboratorContext.newPage();

    try {
      await collaboratorPage.goto('/#/');
      await waitForZeppelinReady(collaboratorPage);
      await performLoginIfRequired(collaboratorPage);
      await skipWhenAuthenticationIsStillRequired(collaboratorPage);
      await openNotebook(collaboratorPage, noteId);

      await expect(editor(page)).toBeVisible({ timeout: 15000 });
      await expect(editor(collaboratorPage)).toBeVisible({ timeout: 15000 });

      await editor(page).click();
      await page.keyboard.type(syncText);

      await expect(editorText(page)).toContainText(syncText, { timeout: 15000 });
      await expect(editorText(collaboratorPage)).toContainText(syncText, { timeout: 30000 });
    } finally {
      await collaboratorContext.close();
    }
  });
});
