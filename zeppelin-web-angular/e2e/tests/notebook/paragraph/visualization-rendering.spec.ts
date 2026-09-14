/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { expect, Locator, Page, test } from '@playwright/test';
import { NotebookParagraphPage } from 'e2e/models/notebook-paragraph-page';
import { NotebookVisualizationPage } from 'e2e/models/notebook-visualization-page';
import {
  addPageAnnotation,
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  performLoginIfRequired,
  setParagraphText,
  waitForZeppelinReady
} from '../../../utils';

const TABLE_PARAGRAPH = `%sh
printf '%%table city\\tsales\\tcost\\tprofit\\nSeoul\\t30\\t12\\t18\\nBusan\\t20\\t8\\t12\\nIncheon\\t10\\t5\\t5\\n'`;
const TABLE_HEADERS = ['city', 'sales', 'cost', 'profit'];
const TABLE_CELLS = ['Seoul', '30', '12', '18', 'Busan', '20', '8', '12', 'Incheon', '10', '5', '5'];

interface SavedGraphConfig {
  keys?: Array<{ name?: string }>;
  values?: Array<{ name?: string }>;
  setting?: {
    multiBarChart?: { rotate?: { degree?: string }; xLabelStatus?: string };
    scatterChart?: { xAxis?: { name?: string }; yAxis?: { name?: string } };
  };
}

const waitForSavedGraph = async (
  page: Page,
  noteId: string,
  paragraphId: string,
  matches: (graph: SavedGraphConfig) => boolean
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/notebook/${noteId}`, { failOnStatusCode: false });
        if (!response.ok()) {
          return false;
        }
        const json = (await response.json()) as {
          body?: { paragraphs?: Array<{ id?: string; config?: { results?: Array<{ graph?: SavedGraphConfig }> } }> };
        };
        const paragraph = json.body?.paragraphs?.find(item => item.id === paragraphId);
        const graph = paragraph?.config?.results?.[0]?.graph;
        return graph ? matches(graph) : false;
      },
      { message: 'visualization settings should be persisted by the server' }
    )
    .toBe(true);
};

test.describe('Notebook Visualization Rendering', () => {
  addPageAnnotationBeforeEach(PAGES.VISUALIZATIONS.TABLE);

  let paragraphPage: NotebookParagraphPage;
  let visualizationPage: NotebookVisualizationPage;
  let noteId: string;
  let paragraphId: string;

  test.beforeEach(async ({ page }) => {
    await test.step('Given a notebook paragraph with deterministic table output', async () => {
      await page.goto('/#/');
      await waitForZeppelinReady(page);
      await performLoginIfRequired(page);

      const notebook = await createTestNotebook(page);
      noteId = notebook.noteId;
      paragraphId = notebook.paragraphId;
      await setParagraphText(page, noteId, paragraphId, TABLE_PARAGRAPH);

      paragraphPage = new NotebookParagraphPage(page);
      visualizationPage = new NotebookVisualizationPage(page);
      await page.goto(`/#/notebook/${noteId}`);
      await expect(paragraphPage.paragraphContainer).toBeVisible({ timeout: 30000 });

      await paragraphPage.runParagraph();
      await expect(visualizationPage.dataTable).toBeVisible({ timeout: 30000 });
    });
  });

  test('renders the exact table headers and rows', async () => {
    await test.step('Then the table presents every output field and value', async () => {
      await expect(visualizationPage.tableMode.locator('input[type="radio"]')).toBeChecked();
      await expect(visualizationPage.tableHeaders).toHaveText(TABLE_HEADERS);
      await expect(visualizationPage.tableCells).toHaveText(TABLE_CELLS);
    });
  });

  test('renders every G2 chart and preserves table data after switching back', async ({}, testInfo) => {
    const charts: Array<{ name: string; page: string; mode: Locator; canvas: Locator }> = [
      {
        name: 'Bar Chart',
        page: PAGES.VISUALIZATIONS.BAR_CHART,
        mode: visualizationPage.barChartMode,
        canvas: visualizationPage.barChartCanvas
      },
      {
        name: 'Pie Chart',
        page: PAGES.VISUALIZATIONS.PIE_CHART,
        mode: visualizationPage.pieChartMode,
        canvas: visualizationPage.pieChartCanvas
      },
      {
        name: 'Line Chart',
        page: PAGES.VISUALIZATIONS.LINE_CHART,
        mode: visualizationPage.lineChartMode,
        canvas: visualizationPage.lineChartCanvas
      },
      {
        name: 'Area Chart',
        page: PAGES.VISUALIZATIONS.AREA_CHART,
        mode: visualizationPage.areaChartMode,
        canvas: visualizationPage.areaChartCanvas
      },
      {
        name: 'Scatter Chart',
        page: PAGES.VISUALIZATIONS.SCATTER_CHART,
        mode: visualizationPage.scatterChartMode,
        canvas: visualizationPage.scatterChartCanvas
      }
    ];

    for (const chart of charts) {
      await test.step(`When selecting ${chart.name}`, async () => {
        addPageAnnotation(chart.page, testInfo);
        await expect(async () => {
          await chart.mode.click();
          await expect(chart.mode.locator('input[type="radio"]')).toBeChecked({ timeout: 1000 });
        }).toPass({ timeout: 10000 });
      });

      await test.step(`Then ${chart.name} draws visible canvas pixels`, async () => {
        await expect(chart.canvas).toBeVisible();
        await expect
          .poll(() => visualizationPage.renderedPixelCount(chart.canvas), {
            message: `${chart.name} canvas should contain rendered pixels`
          })
          .toBeGreaterThan(100);
      });
    }

    await test.step('When switching from the final chart back to Table', async () => {
      await expect(async () => {
        await visualizationPage.tableMode.click();
        await expect(visualizationPage.tableMode.locator('input[type="radio"]')).toBeChecked({ timeout: 1000 });
      }).toPass({ timeout: 10000 });
    });

    await test.step('Then the original table data remains intact', async () => {
      await expect(visualizationPage.dataTable).toBeVisible();
      await expect(visualizationPage.tableCells).toHaveText(TABLE_CELLS);
    });
  });

  test('updates pivot and x-axis settings', async ({ page }, testInfo) => {
    addPageAnnotation(PAGES.VISUALIZATIONS.COMMON.PIVOT_SETTING, testInfo);
    addPageAnnotation(PAGES.VISUALIZATIONS.COMMON.X_AXIS_SETTING, testInfo);

    await test.step('Given the bar chart settings are open', async () => {
      await expect(async () => {
        await visualizationPage.barChartMode.click();
        await expect(visualizationPage.barChartMode.locator('input[type="radio"]')).toBeChecked({ timeout: 1000 });
      }).toPass({ timeout: 10000 });
      await visualizationPage.settingTrigger.click();
      await expect(visualizationPage.pivotSetting).toBeVisible();
      await expect(visualizationPage.xAxisSetting).toBeVisible();
    });

    await test.step('When assigning fields to the pivot configuration', async () => {
      await visualizationPage.dragField(visualizationPage.availablePivotField('cost'), visualizationPage.pivotKeys);
      await visualizationPage.dragField(visualizationPage.availablePivotField('profit'), visualizationPage.pivotValues);
    });

    await test.step('Then the selected pivot fields are displayed', async () => {
      await expect(visualizationPage.pivotKeys.getByText('cost', { exact: true })).toBeVisible();
      await expect(visualizationPage.pivotValues.getByText('profit', { exact: true })).toBeVisible();
    });

    await test.step('When rotating the x-axis labels', async () => {
      await visualizationPage.xAxisRotate.click();
      await visualizationPage.xAxisDegree.fill('30');
      await visualizationPage.xAxisDegree.press('Enter');
    });

    await test.step('Then the x-axis setting retains the entered degree', async () => {
      await expect(visualizationPage.xAxisRotate.locator('input[type="radio"]')).toBeChecked();
      await expect(visualizationPage.xAxisDegree).toHaveValue('30');
      await waitForSavedGraph(page, noteId, paragraphId, graph => {
        const keyNames = graph.keys
          ?.map(field => field.name)
          .sort()
          .join(',');
        const valueNames = graph.values
          ?.map(field => field.name)
          .sort()
          .join(',');
        return (
          keyNames === 'city,cost' &&
          valueNames === 'profit,sales' &&
          graph.setting?.multiBarChart?.xLabelStatus === 'rotate' &&
          graph.setting.multiBarChart.rotate?.degree === '30'
        );
      });
    });
  });

  test('updates scatter axis settings', async ({ page }, testInfo) => {
    addPageAnnotation(PAGES.VISUALIZATIONS.COMMON.SCATTER_SETTING, testInfo);

    await test.step('Given the scatter chart settings are open', async () => {
      await expect(async () => {
        await visualizationPage.scatterChartMode.click();
        await expect(visualizationPage.scatterChartMode.locator('input[type="radio"]')).toBeChecked({ timeout: 1000 });
      }).toPass({ timeout: 10000 });
      await visualizationPage.settingTrigger.click();
      await expect(visualizationPage.scatterSetting).toBeVisible();
    });

    await test.step('When assigning cost to the x-axis', async () => {
      await visualizationPage.dragField(
        visualizationPage.availableScatterField('cost'),
        visualizationPage.scatterXAxis
      );
    });

    await test.step('Then the scatter axes show the selected fields', async () => {
      await expect(visualizationPage.scatterXAxis.getByText('cost', { exact: true })).toBeVisible();
      await expect(visualizationPage.scatterYAxis.getByText('sales', { exact: true })).toBeVisible();
      await waitForSavedGraph(page, noteId, paragraphId, graph => {
        return (
          graph.setting?.scatterChart?.xAxis?.name === 'cost' && graph.setting.scatterChart.yAxis?.name === 'sales'
        );
      });
    });
  });
});
