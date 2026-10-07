/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { compareNotebookParity, NotebookParityParticipant } from '../../../parity/notebook-parity-comparison.mjs';
import { NotebookReactRoutePage } from '../../../models/notebook-react-route-page';
import { addPageAnnotationBeforeEach, createTestNotebookWithName, PAGES, waitForZeppelinReady } from '../../../utils';

test.describe('Private React notebook route entry', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_CORE_READ);

  let notebook: NotebookReactRoutePage;

  test.beforeEach(async ({ page }) => {
    notebook = new NotebookReactRoutePage(page);
    const remotePort = process.env.ZEPPELIN_REACT_REMOTE_TEST_PORT;
    if (remotePort) {
      await page.route('http://localhost:3001/**', route => {
        const target = new URL(route.request().url());
        target.port = remotePort;
        return route.continue({ url: target.toString() });
      });
    }
    await page.goto('/#/');
    await waitForZeppelinReady(page);
  });

  test('mounts the private React entry without replacing the default Angular route', async ({ page }) => {
    const { noteId } = await createTestNotebookWithName(page, { namePrefix: 'ReactRouteEntry' });
    try {
      await test.step('When the private React route opens', async () => {
        await notebook.open(noteId);
        await waitForZeppelinReady(page);
      });

      await test.step('Then React reads the route without enabling the editor', async () => {
        await expect(notebook.entry).toBeVisible();
        await expect(notebook.noteHeading).toBeVisible();
        await expect(notebook.legacyNotebook).not.toBeAttached();
        await expect(notebook.fallback.readView).not.toBeAttached();
      });

      await test.step('When the default route opens, the Angular editor bootstraps again', async () => {
        await notebook.openDefault(noteId);
        await waitForZeppelinReady(page);
        await expect(notebook.legacyNotebook).toBeVisible();
        await expect(notebook.entry).not.toBeAttached();
      });
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });

  test('shows the same-route Angular read view when the React remote cannot load', async ({ page }) => {
    const { noteId, notebookName } = await createTestNotebookWithName(page, { namePrefix: 'ReactRouteFallback' });
    try {
      await page.route('**/remoteEntry.js', route => route.abort());

      await test.step('When the remote load fails at entry', async () => {
        await notebook.open(noteId);
        await waitForZeppelinReady(page);
      });

      await test.step('Then the private Core-backed Angular read view remains usable', async () => {
        await expect(notebook.fallback.noteHeading).toHaveText(notebookName);
        await expect(notebook.entry).not.toBeAttached();
        await expect(notebook.legacyNotebook).not.toBeAttached();
        await expect(page).toHaveURL(new RegExp(`/notebook/${noteId}\\?notebookReactPrivate=true$`));
      });
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });

  test(
    'shows imported saved results and chart mappings without edit controls',
    { tag: '@NB-PARITY-070' },
    async ({ page }) => {
      const name = `ReactRead_${Date.now()}`;
      const imported = await page.request.post('/api/notebook/import', {
        params: { notePath: `/__react_read__/${name}` },
        data: {
          name,
          paragraphs: [
            {
              id: 'paragraph_react_read_1',
              title: 'Saved output',
              text: '%md saved code',
              status: 'FINISHED',
              config: { editorHide: false, tableHide: false },
              results: { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'Persisted result text' }] }
            },
            {
              id: 'paragraph_react_read_2',
              title: 'Saved chart',
              text: '%sh saved table',
              status: 'FINISHED',
              config: {
                results: {
                  0: {
                    graph: {
                      mode: 'multiBarChart',
                      keys: [{ name: 'city', index: 2, aggr: 'sum' }],
                      groups: [],
                      values: [{ name: 'amount', index: 3, aggr: 'sum' }]
                    }
                  }
                }
              },
              results: {
                code: 'SUCCESS',
                msg: [{ type: 'TABLE', data: 'unused\tother\tcity\tamount\na\t9\tSeoul\t2' }]
              }
            }
          ]
        }
      });
      expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBe(true);
      const noteId = (await imported.json()).body as string;

      try {
        await test.step('When the imported notebook opens on the private React route', async () => {
          await notebook.open(noteId);
          await waitForZeppelinReady(page);
        });

        await test.step('Then saved paragraphs, output, chart and accessible table appear in order', async () => {
          await expect(notebook.noteHeading).toHaveText(name);
          await expect(notebook.paragraphs).toHaveCount(2);
          await expect(notebook.paragraphs.nth(0)).toContainText('Persisted result text');
          await expect(
            notebook.paragraphs.nth(1).getByRole('img', { name: 'multiBarChart visualization' })
          ).toBeVisible();
          await notebook.paragraphs.nth(1).getByText('View chart data as a table').click();
          await expect(notebook.paragraphs.nth(1).getByRole('table')).toContainText('Seoul');
          await expect(notebook.permissions).toBeVisible();
          await expect(notebook.editor).toHaveCount(0);
          await expect(notebook.writeControls).toHaveCount(0);
          await expect(notebook.legacyNotebook).not.toBeAttached();
        });
      } finally {
        await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
      }
    }
  );

  test('compares the saved note name across three real host routes', { tag: '@NB-PARITY-070' }, async ({ page }) => {
    const registry = JSON.parse(
      readFileSync(resolve(__dirname, '../../../scenarios/notebook-parity.json'), 'utf8')
    ) as { scenarios: Array<{ id: string; observableOutcomes: Array<{ id: string }> }> };
    const outcomeId = 'NB-PARITY-070-OUTCOME-006';
    const fixture = {
      name: `ReactParity_${Date.now()}`,
      paragraphs: [{ id: 'paragraph_react_parity_1', text: '%md parity', status: 'READY' }]
    };
    const participant = (
      id: string,
      route: 'default' | 'core' | 'react'
    ): NotebookParityParticipant<typeof fixture> => ({
      id,
      run: async ({ fixture: current, onCleanup }) => {
        const imported = await page.request.post('/api/notebook/import', {
          params: { notePath: `/__react_parity__/${current.name}` },
          data: current
        });
        expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBe(true);
        const noteId = (await imported.json()).body as string;
        onCleanup(async () => {
          const deleted = await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
          expect(deleted.ok(), `Notebook cleanup failed: ${deleted.status()}`).toBe(true);
        });
        if (route === 'default') await notebook.openDefault(noteId);
        if (route === 'core') await notebook.fallback.open(noteId);
        if (route === 'react') await notebook.open(noteId);
        await waitForZeppelinReady(page);
        const heading =
          route === 'default'
            ? notebook.defaultTitle(current.name)
            : route === 'core'
              ? notebook.fallback.noteHeading
              : notebook.noteHeading;
        await expect(heading).toHaveText(current.name);
        return { [outcomeId]: { status: 'observed', value: await heading.textContent(), evidence: [page.url()] } };
      }
    });

    const report = await test.step('When the runner observes independent imported notes on each route', () =>
      compareNotebookParity({
        registry,
        checkpoint: { id: 'read-only-note-name-smoke', requiredOutcomes: [outcomeId] },
        fixture,
        baseline: participant('angular-baseline', 'default'),
        implementations: {
          'angular-core': participant('angular-core', 'core'),
          react: participant('react', 'react')
        }
      }));

    await test.step('Then the host-backed checkpoint passes while the full scenario remains unverified', () => {
      expect(report.checkpoint).toMatchObject({ status: 'pass', failures: [] });
      expect(report.implementations).toHaveLength(2);
      for (const implementation of report.implementations) {
        const scenario = implementation.scenarios.find(candidate => candidate.id === 'NB-PARITY-070');
        expect(scenario?.outcomes.find(outcome => outcome.id === outcomeId)?.status).toBe('pass');
        expect(scenario?.outcomes.find(outcome => outcome.id === 'NB-PARITY-070-OUTCOME-005')?.status).toBe('fail');
      }
    });
  });
});
