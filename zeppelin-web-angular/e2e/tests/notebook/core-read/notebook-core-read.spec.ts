/*
 * Licensed under the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { expect, test } from '@playwright/test';
import { NotebookCoreReadPage } from '../../../models/notebook-core-read-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebookWithName,
  PAGES,
  setParagraphText,
  waitForZeppelinReady
} from '../../../utils';

test.describe('Private notebook Core read view', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_CORE_READ);

  let notebook: NotebookCoreReadPage;

  test.beforeEach(async ({ page }) => {
    notebook = new NotebookCoreReadPage(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
  });

  test('shows a saved note and paragraph without entering the legacy notebook', async ({ page }) => {
    const { noteId, paragraphId, notebookName } = await createTestNotebookWithName(page, {
      namePrefix: 'CoreRead'
    });

    try {
      await test.step('Given a saved paragraph', async () => {
        await setParagraphText(page, noteId, paragraphId, '%md hello core read');
      });

      await test.step('When the private read-only route opens', async () => {
        await notebook.open(noteId);
        await waitForZeppelinReady(page);
        await expect(notebook.readView).toBeVisible();
      });

      await test.step('Then the saved note and paragraph appear', async () => {
        await expect(notebook.noteHeading).toHaveText(notebookName);
        await expect(notebook.readView.getByText('%md hello core read', { exact: true })).toBeVisible();
        await expect(notebook.legacyNotebook).not.toBeAttached();
      });
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });

  test('keeps the current note when the route changes between notes', async ({ page }) => {
    const first = await createTestNotebookWithName(page, { namePrefix: 'CoreReadFirst' });
    const second = await createTestNotebookWithName(page, { namePrefix: 'CoreReadSecond' });

    try {
      await setParagraphText(page, first.noteId, first.paragraphId, '%md first note');
      await setParagraphText(page, second.noteId, second.paragraphId, '%md second note');

      await notebook.open(first.noteId);
      await expect(notebook.noteHeading).toHaveText(first.notebookName);
      await expect(notebook.readView.getByText('%md first note', { exact: true })).toBeVisible();

      await notebook.changeRoute(second.noteId);
      await expect(notebook.noteHeading).toHaveText(second.notebookName);
      await expect(notebook.readView.getByText('%md second note', { exact: true })).toBeVisible();
      await expect(notebook.readView.getByText('%md first note', { exact: true })).not.toBeAttached();

      await notebook.changeRoute(first.noteId);
      await expect(notebook.noteHeading).toHaveText(first.notebookName);
      await expect(notebook.readView.getByText('%md first note', { exact: true })).toBeVisible();
      await expect(notebook.readView.getByText('%md second note', { exact: true })).not.toBeAttached();
    } finally {
      await page.request.delete(`/api/notebook/${first.noteId}`, { failOnStatusCode: false });
      await page.request.delete(`/api/notebook/${second.noteId}`, { failOnStatusCode: false });
    }
  });

  test('shows an error instead of another note for a missing note', async ({ page }) => {
    const { noteId, notebookName } = await createTestNotebookWithName(page, { namePrefix: 'CoreReadMissing' });

    try {
      await notebook.open(noteId);
      await expect(notebook.noteHeading).toHaveText(notebookName);

      await notebook.changeRoute('notebook_core_read_missing');
      await expect(notebook.notFoundAlert).toBeVisible();
      await expect(notebook.noteHeading).not.toBeAttached();
      await expect(notebook.legacyNotebook).not.toBeAttached();
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });

  test('leaves the default notebook route on the Angular editor', async ({ page }) => {
    const { noteId, notebookName } = await createTestNotebookWithName(page, { namePrefix: 'CoreReadDefault' });

    try {
      await notebook.open(noteId, undefined, false);
      await waitForZeppelinReady(page);
      await expect(notebook.legacyNotebook).toBeVisible();
      await expect(notebook.legacyNotebook.getByText(notebookName, { exact: true })).toBeVisible();
      await expect(notebook.readView).not.toBeAttached();
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });

  test('shows a saved revision without replacing the live note', async ({ page }) => {
    const capabilities = await page.request.get('/api/notebook/capabilities');
    expect(capabilities.ok()).toBe(true);
    const { body } = await capabilities.json();
    expect(typeof body.isRevisionSupported).toBe('boolean');
    test.skip(!body.isRevisionSupported, 'The configured notebook storage does not support revisions');

    const { noteId, paragraphId } = await createTestNotebookWithName(page, { namePrefix: 'CoreReadRevision' });

    try {
      await setParagraphText(page, noteId, paragraphId, '%md saved revision');
      const checkpoint = await page.request.post(`/api/notebook/${noteId}/revision`, {
        data: { commitMessage: 'core read revision' }
      });
      expect(checkpoint.ok()).toBe(true);
      const { body: revisionId } = await checkpoint.json();
      expect(typeof revisionId).toBe('string');

      await setParagraphText(page, noteId, paragraphId, '%md live note');
      await notebook.open(noteId, revisionId);
      await expect(notebook.readView.getByText('%md saved revision', { exact: true })).toBeVisible();
      await expect(notebook.readView.getByText('%md live note', { exact: true })).not.toBeAttached();

      await notebook.changeRoute(noteId);
      await expect(notebook.readView.getByText('%md live note', { exact: true })).toBeVisible();
      await expect(notebook.readView.getByText('%md saved revision', { exact: true })).not.toBeAttached();
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });
});
