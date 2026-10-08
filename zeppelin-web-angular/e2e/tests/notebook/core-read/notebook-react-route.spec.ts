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
import { expect, test, type Locator } from '@playwright/test';
import { compareNotebookParity, NotebookParityParticipant } from '../../../parity/notebook-parity-comparison.mjs';
import { DarkModePage } from '../../../models/dark-mode-page';
import { NotebookReactRoutePage } from '../../../models/notebook-react-route-page';
import { NotebookVisualizationPage } from '../../../models/notebook-visualization-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebookWithName,
  PAGES,
  setParagraphText,
  waitForZeppelinReady
} from '../../../utils';

const savedReadNotebook = (name: string) => ({
  name,
  paragraphs: [
    {
      id: 'paragraph_react_read_1',
      title: 'Saved output',
      text: '%md saved code',
      status: 'FINISHED',
      config: { title: true, editorHide: false, tableHide: false },
      results: { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'Persisted result text' }] }
    },
    {
      id: 'paragraph_react_read_2',
      title: 'Saved chart',
      text: '%sh saved table',
      status: 'FINISHED',
      config: {
        title: true,
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
});

const chartModes = [
  { mode: 'multiBarChart', title: 'Bar chart', angularTag: 'zeppelin-bar-chart-visualization' },
  { mode: 'pieChart', title: 'Pie chart', angularTag: 'zeppelin-pie-chart-visualization' },
  { mode: 'lineChart', title: 'Line chart', angularTag: 'zeppelin-line-chart-visualization' },
  { mode: 'stackedAreaChart', title: 'Area chart', angularTag: 'zeppelin-area-chart-visualization' },
  { mode: 'scatterChart', title: 'Scatter chart', angularTag: 'zeppelin-scatter-chart-visualization' }
] as const;

const visualizationNotebook = (name: string) => ({
  name,
  paragraphs: chartModes.map(({ mode, title }, index) => ({
    id: `paragraph_read_chart_${index}`,
    title,
    text: '%sh saved table',
    status: 'FINISHED',
    config: {
      title: true,
      results: {
        0: {
          graph: {
            mode,
            keys: [{ name: 'city', index: 0, aggr: 'sum' }],
            groups: [],
            values: [{ name: 'sales', index: 1, aggr: 'sum' }],
            setting: {
              scatterChart: {
                xAxis: { name: 'sales', index: 1, aggr: 'sum' },
                yAxis: { name: 'cost', index: 2, aggr: 'sum' },
                group: { name: 'city', index: 0, aggr: 'sum' }
              }
            }
          }
        }
      }
    },
    results: {
      code: 'SUCCESS',
      msg: [{ type: 'TABLE', data: 'city\tsales\tcost\nSeoul\t30\t12\nBusan\t20\t8\nIncheon\t10\t5' }]
    }
  }))
});

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
    const notebookName = `ReactRouteFallback_${Date.now()}`;
    const imported = await page.request.post('/api/notebook/import', {
      params: { notePath: `/__react_read__/${notebookName}` },
      data: savedReadNotebook(notebookName)
    });
    expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBe(true);
    const noteId = (await imported.json()).body as string;
    try {
      const permissions = await page.request.get(`/api/notebook/${noteId}/permissions`);
      expect(permissions.ok(), `Permissions read failed: ${permissions.status()}`).toBe(true);
      const owners = ((await permissions.json()).body.owners as string[]).join(', ') || 'None';
      await page.route('**/remoteEntry.js', route => route.abort());

      await test.step('When the remote load fails at entry', async () => {
        await notebook.open(noteId);
        await waitForZeppelinReady(page);
      });

      await test.step('Then the private Core-backed Angular read view remains usable', async () => {
        await expect(notebook.fallback.noteHeading).toHaveText(notebookName);
        await expect(notebook.fallbackSavedText).toBeVisible();
        await expect(notebook.fallbackChartCanvas).toBeVisible();
        await expect(notebook.fallbackPermissions).toContainText(`Owners: ${owners}`);
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
        data: savedReadNotebook(name)
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
          await expect(notebook.paragraphWithTitle('Saved output')).toContainText('Persisted result text');
          await expect(
            notebook.paragraphWithTitle('Saved chart').getByRole('img', { name: 'multiBarChart visualization' })
          ).toBeVisible();
          await notebook.paragraphWithTitle('Saved chart').getByText('View chart data as a table').click();
          const chartData = notebook.paragraphWithTitle('Saved chart').getByRole('table');
          await expect(chartData.getByRole('columnheader', { name: 'city', exact: true })).toBeVisible();
          await expect(chartData.getByRole('columnheader', { name: 'amount(sum)', exact: true })).toBeVisible();
          await expect(chartData.getByRole('rowheader', { name: 'Seoul' })).toBeVisible();
          await expect(chartData.getByRole('cell', { name: '2' })).toBeVisible();
          await expect(chartData).not.toContainText('unused');
          await expect(chartData).not.toContainText('other');
          await expect(notebook.permissions).toBeVisible();
          await expect(notebook.editor).toHaveCount(0);
          await expect(notebook.writeControls).toHaveCount(0);
          await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'true');
          await expect(notebook.legacyNotebook).not.toBeAttached();
        });
      } finally {
        await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
      }
    }
  );

  test(
    'keeps the existing five visualization outputs readable from saved data',
    { tag: '@NB-PARITY-070' },
    async ({ page }) => {
      const name = `ReactReadCharts_${Date.now()}`;
      const imported = await page.request.post('/api/notebook/import', {
        params: { notePath: `/__react_read__/${name}` },
        data: visualizationNotebook(name)
      });
      expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBe(true);
      const noteId = (await imported.json()).body as string;
      const visualization = new NotebookVisualizationPage(page);
      try {
        await test.step('Given the same saved table rows used by the Angular visualization E2E', async () => {
          await notebook.openDefault(noteId);
          await waitForZeppelinReady(page);
          for (const [index, { angularTag }] of chartModes.entries()) {
            const canvas = notebook.legacyChartCanvas(index, angularTag);
            await expect(canvas).toBeVisible();
            await expect.poll(() => visualization.renderedPixelCount(canvas)).toBeGreaterThan(100);
          }
        });

        await test.step('Then every saved React chart draws pixels and exposes its rows through the keyboard', async () => {
          await notebook.open(noteId);
          await expect(notebook.paragraphs).toHaveCount(chartModes.length);
          await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'true');
          for (const { mode, title } of chartModes) {
            const paragraph = notebook.paragraphWithTitle(title);
            const canvas = paragraph.getByRole('img', { name: `${mode} visualization` });
            await expect(canvas).toBeVisible();
            await expect.poll(() => visualization.renderedPixelCount(canvas)).toBeGreaterThan(100);
            const disclosure = paragraph.getByText('View chart data as a table', { exact: true });
            await disclosure.focus();
            await expect(disclosure).toBeFocused();
            await page.keyboard.press('Enter');
            const table = paragraph.getByRole('table');
            await expect(table).toBeVisible();
            await expect(
              table.getByRole('rowheader', { name: mode === 'scatterChart' ? 'Seoul' : 'Busan' })
            ).toBeVisible();
            await expect(table).toContainText(mode === 'scatterChart' ? '12' : '20');
          }
        });
      } finally {
        await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
      }
    }
  );

  test('sends an unsupported saved visualization to the default Angular route', async ({ page }) => {
    const name = `ReactReadHelium_${Date.now()}`;
    const fixture = savedReadNotebook(name);
    const graph = fixture.paragraphs[1].config.results?.[0].graph;
    if (!graph) throw new Error('The saved chart fixture needs a graph configuration');
    graph.mode = 'helium-unsupported';
    const imported = await page.request.post('/api/notebook/import', {
      params: { notePath: `/__react_read__/${name}` },
      data: fixture
    });
    expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBe(true);
    const noteId = (await imported.json()).body as string;
    try {
      await notebook.open(noteId);
      await expect(notebook.entry.getByRole('alert')).toContainText('cannot display');
      await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'false');
      await expect(notebook.fallback.readView).not.toBeAttached();
      await notebook.entry.getByRole('link', { name: 'Open the default Angular notebook' }).click();
      await expect(page).toHaveURL(new RegExp(`/#/notebook/${noteId}$`));
      await expect(notebook.legacyNotebook).toBeVisible();
      await expect(notebook.entry).not.toBeAttached();
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });

  test(
    'reads a persisted revision and returns to the live note without showing stale content',
    { tag: '@NB-PARITY-070' },
    async ({ page }) => {
      const capabilities = await page.request.get('/api/notebook/capabilities');
      expect(capabilities.ok()).toBe(true);
      const { body } = await capabilities.json();
      expect(typeof body.isRevisionSupported).toBe('boolean');
      test.skip(!body.isRevisionSupported, 'The configured notebook storage does not support revisions');

      const { noteId, paragraphId } = await createTestNotebookWithName(page, { namePrefix: 'ReactReadRevision' });
      try {
        await setParagraphText(page, noteId, paragraphId, '%md saved revision');
        const checkpoint = await page.request.post(`/api/notebook/${noteId}/revision`, {
          data: { commitMessage: 'react read revision' }
        });
        expect(checkpoint.ok(), `Revision save failed: ${checkpoint.status()}`).toBe(true);
        const { body: revisionId } = await checkpoint.json();
        expect(typeof revisionId).toBe('string');
        await setParagraphText(page, noteId, paragraphId, '%md live note');

        await test.step('Then all three routes show the saved revision', async () => {
          await page.goto(`/#/notebook/${noteId}/revision/${revisionId}`);
          await expect(notebook.legacyNotebook.getByTestId(paragraphId)).toContainText('saved revision');
          await expect(notebook.legacyNotebook.getByTestId(paragraphId)).not.toContainText('live note');

          await notebook.fallback.open(noteId, revisionId);
          await expect(notebook.fallback.readView.getByText('%md saved revision', { exact: true })).toBeVisible();
          await expect(notebook.fallback.readView.getByText('%md live note', { exact: true })).not.toBeAttached();

          await notebook.open(noteId, revisionId);
          await expect(notebook.entry.getByText('%md saved revision', { exact: true })).toBeVisible();
          await expect(notebook.entry.getByText('%md live note', { exact: true })).not.toBeAttached();
          await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'true');
        });

        await test.step('When React returns to the live note, the revision content disappears', async () => {
          await notebook.changeRoute(noteId);
          await expect(notebook.entry.getByText('%md live note', { exact: true })).toBeVisible();
          await expect(notebook.entry.getByText('%md saved revision', { exact: true })).not.toBeAttached();
          await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'true');
        });
      } finally {
        await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
      }
    }
  );

  test('clears readiness and stale content for a missing route target', async ({ page }) => {
    const { noteId, notebookName } = await createTestNotebookWithName(page, { namePrefix: 'ReactReadMissing' });
    try {
      await notebook.open(noteId);
      await expect(notebook.noteHeading).toHaveText(notebookName);
      await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'true');

      await notebook.changeRoute('notebook_react_read_missing');
      await expect(notebook.entry.getByRole('alert')).toContainText('Notebook not found.');
      await expect(notebook.noteHeading).not.toBeAttached();
      await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'false');

      await notebook.changeRoute(noteId);
      await expect(notebook.noteHeading).toHaveText(notebookName);
      await expect(notebook.reactHost).toHaveAttribute('data-read-ready', 'true');
    } finally {
      await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
    }
  });

  test(
    'keeps saved chart data readable through live light, dark and system theme changes and reload',
    { tag: '@NB-PARITY-070' },
    async ({ page }) => {
      const name = `ReactReadTheme_${Date.now()}`;
      const imported = await page.request.post('/api/notebook/import', {
        params: { notePath: `/__react_read__/${name}` },
        data: savedReadNotebook(name)
      });
      expect(imported.ok(), `Notebook import failed: ${imported.status()} ${await imported.text()}`).toBe(true);
      const noteId = (await imported.json()).body as string;
      const theme = new DarkModePage(page);
      try {
        await test.step('Given a saved chart in the light theme', async () => {
          await page.emulateMedia({ colorScheme: 'light' });
          await theme.setThemeInLocalStorage('light');
          await page.reload();
          await waitForZeppelinReady(page);
          await notebook.open(noteId);
          await waitForZeppelinReady(page);
          await theme.assertLightTheme();
          await expect(notebook.paragraphWithTitle('Saved output')).toContainText('Persisted result text');
          await expect(
            notebook.paragraphWithTitle('Saved chart').getByRole('img', { name: 'multiBarChart visualization' })
          ).toBeVisible();
        });

        await test.step('When the theme changes to dark, saved chart data remains readable', async () => {
          await theme.toggleTheme();
          await theme.assertDarkTheme();
          await expect(notebook.paragraphWithTitle('Saved output')).toContainText('Persisted result text');
          await expect(
            notebook.paragraphWithTitle('Saved chart').getByRole('img', { name: 'multiBarChart visualization' })
          ).toBeVisible();
          await notebook.paragraphWithTitle('Saved chart').getByText('View chart data as a table').click();
          const chartData = notebook.paragraphWithTitle('Saved chart').getByRole('table');
          await expect(chartData).toBeVisible();
          await expect(chartData).toContainText('Seoul');
          await expect(chartData).toContainText('2');
        });

        await test.step('When the theme changes to system, saved chart data survives reload', async () => {
          await theme.toggleTheme();
          await theme.assertSystemTheme();
          await expect(notebook.paragraphWithTitle('Saved output')).toContainText('Persisted result text');
          await expect(
            notebook.paragraphWithTitle('Saved chart').getByRole('img', { name: 'multiBarChart visualization' })
          ).toBeVisible();
          await page.reload();
          await waitForZeppelinReady(page);
          await theme.assertSystemTheme();
          await expect(notebook.paragraphWithTitle('Saved output')).toContainText('Persisted result text');
          await expect(
            notebook.paragraphWithTitle('Saved chart').getByRole('img', { name: 'multiBarChart visualization' })
          ).toBeVisible();
          await notebook.paragraphWithTitle('Saved chart').getByText('View chart data as a table').click();
          const chartData = notebook.paragraphWithTitle('Saved chart').getByRole('table');
          await expect(chartData).toBeVisible();
          await expect(chartData).toContainText('Seoul');
        });
      } finally {
        await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
      }
    }
  );

  test(
    'compares saved read results across the default, Core and React routes',
    { tag: '@NB-PARITY-070' },
    async ({ page }, testInfo) => {
      const registry = JSON.parse(
        readFileSync(resolve(__dirname, '../../../scenarios/notebook-parity.json'), 'utf8')
      ) as { scenarios: Array<{ id: string; observableOutcomes: Array<{ id: string }> }> };
      const outcome = (number: string) => `NB-PARITY-070-OUTCOME-${number}`;
      const requiredOutcomes = ['001', '002', '004', '006'].map(outcome);
      const fixture = savedReadNotebook(`ReactParity_${Date.now()}`);
      const assertParagraphOrder = async (paragraphs: Locator, attribute: string, ids: string[]) => {
        const observedIds = await paragraphs.evaluateAll(
          (nodes, name) => nodes.map(node => node.getAttribute(name)),
          attribute
        );
        expect(observedIds).toEqual(ids);
      };
      const assertReadOnlyView = async (view: Locator) => {
        await expect(view.getByRole('textbox')).toHaveCount(0);
        await expect(view.getByRole('button')).toHaveCount(0);
      };
      const observeReactChart = async (paragraph: Locator) => {
        const image = paragraph.getByRole('img', { name: 'multiBarChart visualization' });
        await expect(image).toBeVisible();
        await paragraph.getByText('View chart data as a table').click();
        const table = paragraph.getByRole('table');
        await expect(table.getByRole('columnheader', { name: 'amount(sum)', exact: true })).toBeVisible();
        await expect(table.getByRole('rowheader', { name: 'Seoul' })).toBeVisible();
        await expect(table.getByRole('cell', { name: '2' })).toBeVisible();
        return {
          mode: (await image.getAttribute('aria-label'))?.replace(/ visualization$/, '') ?? '',
          keyField: (await table.getByRole('columnheader').nth(0).textContent())?.trim() ?? '',
          metricField: (await table.getByRole('columnheader').nth(1).textContent())?.trim() ?? ''
        };
      };
      const observeAngularChart = async (paragraph: Locator, showSetting: boolean) => {
        const chart = notebook.legacyBarChart(paragraph);
        await expect(chart).toBeVisible();
        await expect(notebook.legacyBarCanvas(chart)).toBeVisible();
        if (showSetting) await paragraph.getByText('Setting', { exact: true }).click();
        const key = notebook.legacyChartField(chart, 0);
        const metric = notebook.legacyChartField(chart, 2);
        await expect(key).toHaveText('city');
        await expect(metric).toContainText('amount');
        await expect(metric).toContainText('SUM');
        return {
          mode: (await chart.evaluate(element => element.tagName.toLowerCase())).replace(
            'zeppelin-bar-chart-visualization',
            'multiBarChart'
          ),
          keyField: (await key.textContent())?.trim() ?? '',
          metricField:
            (await metric.textContent())
              ?.trim()
              .replace(/\s+(\S+)$/, '($1)')
              .toLowerCase() ?? ''
        };
      };
      const observeDefaultPermissions = async (body: Record<string, string[]>) => {
        await notebook.legacyPermissionButton().click();
        await expect(notebook.legacyPermissions).toBeVisible();
        const observed: string[] = [];
        for (const key of ['owners', 'readers', 'writers', 'runners']) {
          const selected = notebook.legacyPermissionSelection(key);
          await expect(selected).toHaveText(body[key]);
          const names = await selected.allTextContents();
          observed.push(`${key[0].toUpperCase()}${key.slice(1)}: ${names.join(', ') || 'None'}`);
        }
        return observed;
      };
      const observeReadPermissions = async (panel: Locator, expected: string[]) => {
        await expect(panel).toBeVisible();
        for (const line of expected) await expect(panel).toContainText(line);
        return (await notebook.permissionLines(panel).allTextContents()).map(line => line.trim());
      };
      const observePrivateThemes = async (view: Locator, chart: Locator) => {
        const theme = new DarkModePage(page);
        const visualization = new NotebookVisualizationPage(page);
        const savedText = view.getByText('Persisted result text', { exact: true });
        const capture = async () => {
          await expect(savedText).toBeVisible();
          await expect(chart).toBeVisible();
          await expect.poll(() => visualization.renderedPixelCount(chart)).toBeGreaterThan(100);
          return {
            theme: await theme.rootElement.getAttribute('data-theme'),
            selectedMode: (await theme.themeToggleButton.textContent())?.trim(),
            result: (await savedText.textContent())?.trim()
          };
        };

        await page.emulateMedia({ colorScheme: 'light' });
        await theme.setThemeInLocalStorage('light');
        await page.reload();
        await waitForZeppelinReady(page);
        await theme.assertLightTheme();
        const light = await capture();
        await theme.toggleTheme();
        await theme.assertDarkTheme();
        const dark = await capture();
        await theme.toggleTheme();
        await theme.assertSystemTheme();
        await page.reload();
        await waitForZeppelinReady(page);
        await theme.assertSystemTheme();
        const system = await capture();
        return { light, dark, system };
      };
      const participant = (
        id: string,
        route: 'default' | 'core' | 'react',
        includePrivateOutcomes = false
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

          const paragraphTitles = ['Saved output', 'Saved chart'];
          const paragraphIds = current.paragraphs.map(paragraph => paragraph.id);
          const paragraphViews =
            route === 'default'
              ? notebook.legacyParagraphs
              : route === 'core'
                ? notebook.coreParagraphs
                : notebook.paragraphs;
          await expect(paragraphViews).toHaveCount(2);
          const titles =
            route === 'default'
              ? await notebook.legacyParagraphTitles().allTextContents()
              : await paragraphViews.getByRole('heading', { level: 2 }).allTextContents();
          expect(titles).toEqual(paragraphTitles);
          if (route === 'default') {
            await assertParagraphOrder(paragraphViews, 'data-testid', paragraphIds);
          } else if (route === 'react') {
            await assertParagraphOrder(paragraphViews, 'id', paragraphIds);
          }

          const textResult = paragraphViews.nth(0).getByText('Persisted result text', { exact: true });
          await expect(textResult).toBeVisible();
          const { mode, keyField, metricField } =
            route === 'react'
              ? await observeReactChart(paragraphViews.nth(1))
              : await observeAngularChart(paragraphViews.nth(1), route === 'default');

          if (route !== 'default') {
            const readView = route === 'core' ? notebook.fallback.readView : notebook.entry;
            await assertReadOnlyView(readView);
          }

          const permissions = await page.request.get(`/api/notebook/${noteId}/permissions`);
          expect(permissions.ok()).toBe(true);
          const permissionBody = (await permissions.json()).body as Record<string, string[]>;
          const expectedPermissions = ['owners', 'readers', 'writers', 'runners'].map(
            key => `${key[0].toUpperCase()}${key.slice(1)}: ${permissionBody[key].join(', ') || 'None'}`
          );
          const observedPermissions =
            route === 'default'
              ? await observeDefaultPermissions(permissionBody)
              : await observeReadPermissions(
                  route === 'core' ? notebook.fallbackPermissions : notebook.permissions,
                  expectedPermissions
                );
          const privateOutcomes: Record<string, { status: 'observed'; value: unknown; evidence: string[] }> = {};
          if (includePrivateOutcomes && route !== 'default') {
            const view = route === 'core' ? notebook.fallback.readView : notebook.entry;
            const chart =
              route === 'core'
                ? notebook.fallbackChartCanvas
                : notebook.paragraphWithTitle('Saved chart').getByRole('img', { name: 'multiBarChart visualization' });
            await assertReadOnlyView(view);
            const controls = {
              textboxes: await view.getByRole('textbox').count(),
              buttons: await view.getByRole('button').count()
            };
            const themes = await observePrivateThemes(view, chart);
            privateOutcomes[outcome('003')] = { status: 'observed', value: controls, evidence: [page.url()] };
            privateOutcomes[outcome('005')] = { status: 'observed', value: themes, evidence: [page.url()] };
          }
          const evidence = [page.url()];
          return {
            [outcome('001')]: { status: 'observed', value: titles, evidence },
            [outcome('002')]: {
              status: 'observed',
              value: { text: (await textResult.textContent())?.trim(), mode, keyField, metricField },
              evidence
            },
            [outcome('004')]: { status: 'observed', value: observedPermissions, evidence },
            [outcome('006')]: { status: 'observed', value: await heading.textContent(), evidence },
            ...privateOutcomes
          };
        }
      });

      const report = await test.step('When the runner observes independent saved notes on each route', () =>
        compareNotebookParity({
          registry,
          checkpoint: { id: 'read-only-notebook-parity', requiredOutcomes },
          fixture,
          baseline: participant('angular-baseline', 'default'),
          implementations: {
            'angular-core': participant('angular-core', 'core'),
            react: participant('react', 'react')
          }
        }));

      await testInfo.attach('notebook-read-parity', {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: 'application/json'
      });

      const privateReport = await test.step('When the private Angular Core view is the read-only baseline', () =>
        compareNotebookParity({
          registry,
          checkpoint: {
            id: 'private-read-only-notebook-parity',
            requiredOutcomes: ['001', '002', '003', '004', '005', '006'].map(outcome)
          },
          fixture,
          baseline: participant('angular-core-baseline', 'core', true),
          implementations: { react: participant('react', 'react', true) }
        }));

      await testInfo.attach('private-read-only-notebook-parity', {
        body: Buffer.from(JSON.stringify(privateReport, null, 2)),
        contentType: 'application/json'
      });

      await test.step('Then every required read outcome matches without claiming unrelated outcomes', () => {
        expect(report.checkpoint).toMatchObject({ status: 'pass', failures: [] });
        expect(report.implementations).toHaveLength(2);
        for (const implementation of report.implementations) {
          const scenario = implementation.scenarios.find(candidate => candidate.id === 'NB-PARITY-070');
          for (const id of requiredOutcomes) {
            expect(scenario?.outcomes.find(result => result.id === id)?.status).toBe('pass');
          }
          expect(scenario?.outcomes.find(result => result.id === outcome('003'))?.status).toBe('fail');
        }
        expect(privateReport.checkpoint).toMatchObject({ status: 'pass', failures: [] });
        expect(
          privateReport.implementations[0].scenarios.find(scenario => scenario.id === 'NB-PARITY-070')?.status
        ).toBe('pass');
      });
    }
  );
});
