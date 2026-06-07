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
import { NotebookParagraphPage } from 'e2e/models/notebook-paragraph-page';
import {
  addPageAnnotationBeforeEach,
  performLoginIfRequired,
  waitForZeppelinReady,
  PAGES,
  createTestNotebook
} from '../../../utils';

// Set the paragraph text and run it server-side via REST so the dynamic form is
// populated before the UI renders it. Auth cookies are shared with page.request.
async function setParagraphAndRun(page: Page, noteId: string, paragraphId: string, text: string): Promise<void> {
  const put = await page.request.put(`/api/notebook/${noteId}/paragraph/${paragraphId}`, { data: { text } });
  expect(put.ok()).toBeTruthy();
  const run = await page.request.post(`/api/notebook/run/${noteId}/${paragraphId}`);
  expect(run.ok()).toBeTruthy();
  // The run populates settings.forms asynchronously; wait until it is FINISHED so
  // the note loads with the form already present (avoids a navigate-before-run race).
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/notebook/${noteId}/paragraph/${paragraphId}`);
        return res.ok() ? (await res.json()).body?.status : undefined;
      },
      { timeout: 30000 }
    )
    .toBe('FINISHED');
}

test.describe('Notebook Paragraph Dynamic Forms', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_PARAGRAPH);

  let paragraphPage: NotebookParagraphPage;
  let testNotebook: { noteId: string; paragraphId: string };

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    testNotebook = await createTestNotebook(page);
    paragraphPage = new NotebookParagraphPage(page);
  });

  async function openNote(page: Page): Promise<void> {
    await page.goto(`/#/notebook/${testNotebook.noteId}`);
    await waitForZeppelinReady(page);
    await page.waitForLoadState('networkidle');
  }

  test('renders a text input form and re-running with a new value updates the output', async ({ page }) => {
    await setParagraphAndRun(page, testNotebook.noteId, testNotebook.paragraphId, '%md\n# Hello ${name=World}');
    await openNote(page);

    // Given: the form renders with its default value and the default output is shown.
    await expect(paragraphPage.dynamicForms).toBeVisible();
    await expect(paragraphPage.formTextInput).toHaveValue('World');
    await expect(paragraphPage.resultDisplay).toContainText('Hello World');

    // When: the user changes the form value and re-runs the paragraph.
    await paragraphPage.formTextInput.fill('Playwright');
    await paragraphPage.runParagraph();

    // Then: the output reflects the new value.
    await expect(paragraphPage.resultDisplay).toContainText('Hello Playwright');
  });

  test('renders a select form and re-running with a new option updates the output', async ({ page }) => {
    await setParagraphAndRun(
      page,
      testNotebook.noteId,
      testNotebook.paragraphId,
      '%md\n# Flavor ${flavor=vanilla,vanilla|choco}'
    );
    await openNote(page);

    // Given: the select form renders and the default option is reflected in the output.
    await expect(paragraphPage.formSelect).toBeVisible();
    await expect(paragraphPage.resultDisplay).toContainText('vanilla');

    // When: the user picks a different option and re-runs.
    await paragraphPage.chooseSelectFormOption('choco');
    await paragraphPage.runParagraph();

    // Then: the output reflects the chosen option.
    await expect(paragraphPage.resultDisplay).toContainText('choco');
  });

  test('does not render the dynamic-form control for a paragraph without form expressions', async ({ page }) => {
    await setParagraphAndRun(page, testNotebook.noteId, testNotebook.paragraphId, '%md\n# No forms here');
    await openNote(page);

    await expect(paragraphPage.resultDisplay).toContainText('No forms here');
    await expect(paragraphPage.dynamicForms).toBeHidden();
  });
});
