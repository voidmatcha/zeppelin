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
import { NotebookParagraphPage } from '../../../models/notebook-paragraph-page';
import { PublishedParagraphPage } from '../../../models/published-paragraph-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  setParagraphText,
  waitForZeppelinReady
} from '../../../utils';

test.describe('Published paragraph streaming', () => {
  // JUSTIFIED: shared owner and notebook state must remain within one worker.
  test.describe.configure({ mode: 'default' });
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.PUBLISHED_PARAGRAPH);

  let owner: NotebookParagraphPage;
  let notebook: { noteId: string; paragraphId: string };

  test.beforeEach(async ({ page }) => {
    owner = new NotebookParagraphPage(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    notebook = await createTestNotebook(page);
  });

  for (const react of [false, true]) {
    test(`accumulates live output and preserves the exact terminal snapshot (${react ? 'React' : 'Angular'})`, async ({
      page,
      context
    }) => {
      const viewer = await context.newPage();
      const published = new PublishedParagraphPage(viewer);

      await test.step('Given a published viewer of a delayed shell paragraph', async () => {
        await setParagraphText(
          page,
          notebook.noteId,
          notebook.paragraphId,
          '%sh\necho first; sleep 4; echo second; sleep 8; echo third'
        );
        await page.goto(`/#/notebook/${notebook.noteId}`);
        await expect(owner.paragraphContainer).toBeVisible();
        await viewer.goto(`/#/notebook/${notebook.noteId}/paragraph/${notebook.paragraphId}?react=${react}`);
        await waitForZeppelinReady(viewer);
        await expect(published.confirmationModal).toBeVisible();
        await published.cancelButton.click();
      });

      await test.step('When the owner runs the paragraph, published output accumulates while RUNNING', async () => {
        await owner.runParagraph();
        await expect(published.textOutput).toHaveText('first');
        await expect(published.textOutput).toBeVisible();
        await expect(owner.status).toHaveText('RUNNING');
        await expect(published.textOutput).toHaveText('first\nsecond');
        await expect(published.textOutput).toBeVisible();
        await expect(owner.status).toHaveText('RUNNING');
      });

      await test.step('Then the terminal snapshot contains every chunk exactly once', async () => {
        await expect(owner.status).toHaveText('FINISHED');
        await expect(published.textOutput).toHaveText('first\nsecond\nthird');
        await expect(published.reactWidget).toHaveCount(react ? 1 : 0);
      });

      await viewer.close();
    });
  }
});
