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

const skipWhenAuthenticationIsStillRequired = async (page: Page): Promise<void> => {
  const loginStillVisible = await page
    .locator('zeppelin-login')
    .isVisible()
    .catch(() => false);
  test.skip(loginStillVisible, 'Authentication is enabled but no E2E test credentials are configured');
};

const editor = (page: Page) => page.locator('zeppelin-notebook-paragraph .monaco-editor').first();
const editorText = (page: Page) => editor(page).locator('.view-lines').first();
const findWidget = (page: Page) => editor(page).locator('.find-widget').first();
const findInput = (page: Page) =>
  findWidget(page).locator('.monaco-findInput .input, input[aria-label="Find"], textarea[aria-label="Find"]').first();
const replaceInput = (page: Page) =>
  findWidget(page)
    .locator('.replace-input .input, input[aria-label="Replace"], textarea[aria-label="Replace"]')
    .first();
const matchesCount = (page: Page) => findWidget(page).locator('.matchesCount').first();
const nextMatchButton = (page: Page) => findWidget(page).locator('.button.next, [title^="Next Match"]').first();
const previousMatchButton = (page: Page) =>
  findWidget(page).locator('.button.previous, [title^="Previous Match"]').first();
const toggleReplaceButton = (page: Page) =>
  findWidget(page).locator('.button.toggle, [title^="Toggle Replace"]').first();
const replaceAllButton = (page: Page) =>
  findWidget(page).locator('.button.replace-all, [title^="Replace All"]').first();

const openNotebook = async (page: Page, noteId: string): Promise<void> => {
  await page.goto(`/#/notebook/${noteId}`);
  await waitForZeppelinReady(page);
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
};

const setEditorContent = async (page: Page, content: string): Promise<void> => {
  await editor(page).click();
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText(content);
  await expect(editorText(page)).toContainText(content.split('\n')[0], { timeout: 15000 });
};

const openFindWidget = async (page: Page): Promise<void> => {
  await editor(page).click();
  await page.keyboard.press('Control+S');
  await expect(findWidget(page)).toBeVisible({ timeout: 15000 });
};

const searchFor = async (page: Page, text: string): Promise<void> => {
  await findInput(page).fill(text);
  await expect(matchesCount(page)).toBeVisible({ timeout: 15000 });
};

test.describe('Notebook editor search', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    await skipWhenAuthenticationIsStillRequired(page);
    await waitForNotebookLinks(page);
  });

  test('shows match count and navigates next and previous matches', async ({ page }) => {
    const { noteId } = await createTestNotebook(page);

    await openNotebook(page, noteId);
    await setEditorContent(page, 'alpha target beta target gamma target');
    await openFindWidget(page);
    await searchFor(page, 'target');

    await expect(matchesCount(page)).toContainText(/1\s*\/\s*3/, { timeout: 15000 });

    await nextMatchButton(page).click();
    await expect(matchesCount(page)).toContainText(/2\s*\/\s*3/, { timeout: 15000 });

    await previousMatchButton(page).click();
    await expect(matchesCount(page)).toContainText(/1\s*\/\s*3/, { timeout: 15000 });
  });

  test('replaces all matches in the editor search widget', async ({ page }) => {
    const { noteId } = await createTestNotebook(page);

    await openNotebook(page, noteId);
    await setEditorContent(page, 'replace_target one replace_target two replace_target');
    await openFindWidget(page);
    await searchFor(page, 'replace_target');
    await expect(matchesCount(page)).toContainText(/1\s*\/\s*3/, { timeout: 15000 });

    await toggleReplaceButton(page).click();
    await replaceInput(page).fill('replacement');
    await replaceAllButton(page).click();

    await expect(editorText(page)).toContainText('replacement one replacement two replacement', { timeout: 15000 });
    await expect(editorText(page)).not.toContainText('replace_target');
  });
});
