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

import { Locator, Page } from '@playwright/test';
import { BasePage } from './base-page';

export class NotebookVisualizationPage extends BasePage {
  readonly tableMode: Locator;
  readonly barChartMode: Locator;
  readonly pieChartMode: Locator;
  readonly lineChartMode: Locator;
  readonly areaChartMode: Locator;
  readonly scatterChartMode: Locator;
  readonly dataTable: Locator;
  readonly tableHeaders: Locator;
  readonly tableCells: Locator;
  readonly barChartCanvas: Locator;
  readonly pieChartCanvas: Locator;
  readonly lineChartCanvas: Locator;
  readonly areaChartCanvas: Locator;
  readonly scatterChartCanvas: Locator;
  readonly settingTrigger: Locator;
  readonly pivotSetting: Locator;
  readonly pivotAvailableFields: Locator;
  readonly pivotKeys: Locator;
  readonly pivotValues: Locator;
  readonly scatterSetting: Locator;
  readonly scatterAvailableFields: Locator;
  readonly scatterXAxis: Locator;
  readonly scatterYAxis: Locator;
  readonly xAxisSetting: Locator;
  readonly xAxisRotate: Locator;
  readonly xAxisDegree: Locator;
  private readonly resultDisplay: Locator;

  constructor(page: Page) {
    super(page);
    this.resultDisplay = page.locator('zeppelin-notebook-paragraph-result');
    this.tableMode = this.resultDisplay.locator('label.viz-icon:has(.anticon-table)');
    this.barChartMode = this.resultDisplay.locator('label.viz-icon:has(.anticon-bar-chart)');
    this.pieChartMode = this.resultDisplay.locator('label.viz-icon:has(.anticon-pie-chart)');
    this.lineChartMode = this.resultDisplay.locator('label.viz-icon:has(.anticon-line-chart)');
    this.areaChartMode = this.resultDisplay.locator('label.viz-icon:has(.anticon-area-chart)');
    this.scatterChartMode = this.resultDisplay.locator('label.viz-icon:has(.anticon-dot-chart)');
    this.dataTable = this.resultDisplay.getByRole('table');
    this.tableHeaders = this.dataTable.locator('thead th');
    this.tableCells = this.dataTable.locator('tbody tr.ant-table-row td');
    this.barChartCanvas = this.resultDisplay.locator('zeppelin-bar-chart-visualization canvas');
    this.pieChartCanvas = this.resultDisplay.locator('zeppelin-pie-chart-visualization canvas');
    this.lineChartCanvas = this.resultDisplay.locator('zeppelin-line-chart-visualization canvas');
    this.areaChartCanvas = this.resultDisplay.locator('zeppelin-area-chart-visualization canvas');
    this.scatterChartCanvas = this.resultDisplay.locator('zeppelin-scatter-chart-visualization canvas');
    this.settingTrigger = this.resultDisplay.getByText('Setting', { exact: true });
    this.pivotSetting = this.resultDisplay.locator('zeppelin-visualization-pivot-setting');
    this.pivotAvailableFields = this.pivotSetting.getByTestId('pivot-available-fields');
    this.pivotKeys = this.pivotSetting.getByTestId('pivot-keys');
    this.pivotValues = this.pivotSetting.getByTestId('pivot-values');
    this.scatterSetting = this.resultDisplay.locator('zeppelin-visualization-scatter-setting');
    this.scatterAvailableFields = this.scatterSetting.getByTestId('scatter-available-fields');
    this.scatterXAxis = this.scatterSetting.getByTestId('scatter-x-axis');
    this.scatterYAxis = this.scatterSetting.getByTestId('scatter-y-axis');
    this.xAxisSetting = this.resultDisplay.locator('zeppelin-visualization-x-axis-setting');
    this.xAxisRotate = this.xAxisSetting.getByTestId('x-axis-label-mode').getByText('Rotate', { exact: true });
    this.xAxisDegree = this.xAxisSetting.getByPlaceholder('degree');
  }

  availablePivotField(name: string): Locator {
    return this.pivotAvailableFields.getByText(name, { exact: true });
  }

  selectedPivotValue(name: string): Locator {
    return this.pivotValues.locator('.field-item').filter({ hasText: name });
  }

  availableScatterField(name: string): Locator {
    return this.scatterAvailableFields.getByText(name, { exact: true });
  }

  async dragField(source: Locator, target: Locator): Promise<void> {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) {
      throw new Error('Visualization drag source and target must be visible');
    }

    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;
    await this.page.mouse.move(sourceX, sourceY);
    await this.page.mouse.down();
    await this.page.mouse.move(sourceX + 10, sourceY, { steps: 5 });
    await this.page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 10
    });
    await this.page.mouse.up();
  }

  async renderedPixelCount(canvas: Locator): Promise<number> {
    return canvas.evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext('2d');
      if (!context || element.width === 0 || element.height === 0) {
        return 0;
      }

      const pixels = context.getImageData(0, 0, element.width, element.height).data;
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) {
          count += 1;
        }
      }
      return count;
    });
  }
}
