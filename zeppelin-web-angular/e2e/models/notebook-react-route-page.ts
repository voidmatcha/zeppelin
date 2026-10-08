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

import { Locator, Page } from '@playwright/test';
import { NotebookCoreReadPage } from './notebook-core-read-page';

export class NotebookReactRoutePage {
  readonly entry: Locator;
  readonly noteHeading: Locator;
  readonly paragraphs: Locator;
  readonly permissions: Locator;
  readonly editor: Locator;
  readonly writeControls: Locator;
  readonly fallback: NotebookCoreReadPage;
  readonly fallbackSavedText: Locator;
  readonly fallbackChartCanvas: Locator;
  readonly fallbackPermissions: Locator;
  readonly legacyNotebook: Locator;
  readonly reactHost: Locator;
  readonly legacyParagraphs: Locator;
  readonly coreParagraphs: Locator;
  readonly legacyPermissions: Locator;

  constructor(private readonly page: Page) {
    this.entry = page.getByTestId('react-notebook-entry');
    this.noteHeading = this.entry.getByRole('heading', { level: 1 });
    this.paragraphs = this.entry.getByTestId('react-notebook-paragraph');
    this.permissions = this.entry.getByRole('region', { name: 'Notebook permissions' });
    this.editor = this.entry.getByRole('textbox');
    this.writeControls = this.entry.getByRole('button', { name: /^(run|save|delete|add paragraph)$/i });
    this.fallback = new NotebookCoreReadPage(page);
    this.fallbackSavedText = this.fallback.readView.getByText('Persisted result text', { exact: true });
    this.fallbackChartCanvas = this.fallback.readView.locator('[data-result-type="TABLE"] canvas');
    this.fallbackPermissions = this.fallback.readView.getByRole('region', { name: 'Notebook permissions' });
    this.legacyNotebook = this.fallback.legacyNotebook;
    this.reactHost = page.locator('zeppelin-notebook-react-entry');
    this.legacyParagraphs = this.legacyNotebook.locator('zeppelin-notebook-paragraph');
    this.coreParagraphs = this.fallback.readView.locator('article');
    this.legacyPermissions = this.legacyNotebook.locator('zeppelin-notebook-permissions');
  }

  async open(noteId: string, revisionId?: string): Promise<void> {
    const revision = revisionId ? `/revision/${revisionId}` : '';
    await this.page.goto(`/#/notebook/${noteId}${revision}?notebookReactPrivate=true`);
  }

  async changeRoute(noteId: string, revisionId?: string): Promise<void> {
    const revision = revisionId ? `/revision/${revisionId}` : '';
    await this.page.evaluate(hash => {
      window.location.hash = hash;
    }, `#/notebook/${noteId}${revision}?notebookReactPrivate=true`);
  }

  async openDefault(noteId: string): Promise<void> {
    await this.page.goto(`/#/notebook/${noteId}`);
  }

  defaultTitle(name: string): Locator {
    return this.legacyNotebook.getByText(name, { exact: true }).first();
  }

  paragraphWithTitle(title: string): Locator {
    return this.paragraphs.filter({ has: this.page.getByRole('heading', { name: title, exact: true }) });
  }

  legacyChartCanvas(index: number, chartTag: string): Locator {
    return this.legacyNotebook.getByTestId(`paragraph_read_chart_${index}`).locator(`${chartTag} canvas`);
  }

  legacyParagraphTitles(): Locator {
    return this.legacyParagraphs.locator('zeppelin-elastic-input p');
  }

  legacyBarChart(paragraph: Locator): Locator {
    return paragraph.locator('zeppelin-bar-chart-visualization');
  }

  legacyBarCanvas(chart: Locator): Locator {
    return chart.locator('canvas');
  }

  legacyChartField(chart: Locator, index: number): Locator {
    return chart.locator('.field-setting-wrap nz-card').nth(index).locator('.drag-tag');
  }

  legacyPermissionButton(): Locator {
    return this.legacyNotebook
      .locator('zeppelin-notebook-action-bar button')
      .filter({ has: this.page.locator('.anticon-lock') });
  }

  legacyPermissionSelection(key: string): Locator {
    return this.legacyPermissions.locator(`nz-select[name="${key}"] .ant-select-selection-item`);
  }

  permissionLines(panel: Locator): Locator {
    return panel.locator('p');
  }
}
