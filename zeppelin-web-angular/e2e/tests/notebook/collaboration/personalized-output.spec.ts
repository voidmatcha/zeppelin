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
import { LoginTestUtil } from 'e2e/models/login-page.util';
import { NotebookParagraphPage } from 'e2e/models/notebook-paragraph-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  setParagraphText,
  waitForZeppelinReady
} from '../../../utils';

test.describe('Personalized interpreter output', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_PARAGRAPH);

  test('resumes a cleared user stream after refresh without changing the other viewer result', async ({
    page,
    browser,
    baseURL
  }) => {
    test.skip(!(await LoginTestUtil.isShiroEnabled()), 'Personalized output requires authenticated users');
    const credentials = Object.entries(await LoginTestUtil.getTestCredentials())
      .filter(([key]) => key !== 'INVALID_USER' && key !== 'EMPTY_CREDENTIALS')
      .map(([, value]) => value);
    test.skip(credentials.length < 2, 'Personalized output requires two configured test users');

    const owner = new CollaborationPage(page);
    const ownerParagraph = new NotebookParagraphPage(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    expect(await owner.getPrincipal()).toBe(credentials[0].username);
    const notebook = await createTestNotebook(page);

    await test.step('Given an owner with a saved result in a personalized notebook', async () => {
      await setParagraphText(page, notebook.noteId, notebook.paragraphId, '%sh\necho owner_saved_result');
      await owner.openNotebook(notebook.noteId);
      await owner.switchToPersonalModeButton.click();
      await owner.confirmPersonalizedModeChange();
      await expect(owner.switchToCollaborationModeButton).toBeVisible();
      await ownerParagraph.runParagraph();
      await expect(ownerParagraph.status).toHaveText('FINISHED');
      await expect(ownerParagraph.resultDisplay).toContainText('owner_saved_result');
      // REST edits the master; seed it before the second user creates a personal copy.
      await setParagraphText(
        page,
        notebook.noteId,
        notebook.paragraphId,
        '%sh\necho viewer_first_chunk; sleep 12; echo viewer_resumed_chunk; sleep 12; echo viewer_final_chunk'
      );
    });

    const viewerContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const login = await viewerContext.request.post('/api/login', {
        form: { userName: credentials[1].username, password: credentials[1].password }
      });
      expect(login.ok()).toBe(true);
      const viewerPage = await viewerContext.newPage();
      const viewer = new CollaborationPage(viewerPage);
      const viewerParagraph = new NotebookParagraphPage(viewerPage);

      await test.step('When another user runs their own delayed shell output', async () => {
        await viewer.openNotebook(notebook.noteId);
        expect(await viewer.getPrincipal()).toBe(credentials[1].username);
        await expect(viewer.editorText).toContainText('viewer_first_chunk');
        await viewerParagraph.runParagraph();
      });

      await test.step('Then only that user sees the intermediate output', async () => {
        await expect(viewerParagraph.resultDisplay).toContainText('viewer_first_chunk');
        await expect(viewerParagraph.status).toHaveText('RUNNING');
        await expect(ownerParagraph.resultDisplay).toContainText('owner_saved_result');
        await expect(ownerParagraph.resultDisplay).not.toContainText('viewer_first_chunk');
      });

      await test.step('When the running user clears their output', async () => {
        await viewerParagraph.openSettingsDropdown();
        await viewerParagraph.clearOutputOption.click();
        await expect(viewerParagraph.resultDisplay).toBeHidden();
        await expect(viewerParagraph.status).toHaveText('RUNNING');
        await expect(ownerParagraph.resultDisplay).toContainText('owner_saved_result');
      });

      await test.step('When the running user refreshes the cleared notebook', async () => {
        await viewerPage.reload();
        await waitForZeppelinReady(viewerPage);
        await expect(viewerParagraph.status).toHaveText('RUNNING');
        await expect(viewerParagraph.resultDisplay).toBeHidden();
      });

      await test.step('Then the next append is visible while running without the cleared text', async () => {
        await expect(viewerParagraph.resultDisplay).toContainText('viewer_resumed_chunk', { timeout: 15000 });
        await expect(viewerParagraph.status).toHaveText('RUNNING');
        await expect(viewerParagraph.resultDisplay).not.toContainText('viewer_first_chunk');
        await expect(ownerParagraph.resultDisplay).toContainText('owner_saved_result');
        await expect(ownerParagraph.resultDisplay).not.toContainText('viewer_resumed_chunk');
        await expect(viewerParagraph.resultDisplay).toContainText('viewer_final_chunk', { timeout: 15000 });
        await expect(viewerParagraph.status).toHaveText('FINISHED');
        await expect(ownerParagraph.resultDisplay).toContainText('owner_saved_result');
        await expect(ownerParagraph.resultDisplay).not.toContainText('viewer_final_chunk');
      });
    } finally {
      await viewerContext.close();
    }
  });
});
