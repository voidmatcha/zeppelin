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

import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from './base-page';

export class NotebookParagraphPage extends BasePage {
  readonly paragraphContainer: Locator;
  readonly addParagraphAbove: Locator;
  readonly addParagraphBelow: Locator;
  readonly controlPanel: Locator;
  readonly controlPanels: Locator;
  readonly codeEditor: Locator;
  readonly dynamicForms: Locator;
  readonly resultDisplay: Locator;
  readonly footerInfo: Locator;
  readonly runButton: Locator;
  readonly settingsDropdown: Locator;
  readonly status: Locator;
  readonly cancelButton: Locator;
  readonly exportDropdownTrigger: Locator;
  readonly exportMenu: Locator;
  readonly checkInterpreterHealthItem: Locator;
  readonly interpreterHealthStatus: Locator;
  readonly interpreterHealthPulse: Locator;
  readonly interpreterHealthLabel: Locator;
  readonly noInterpreterHint: Locator;

  constructor(page: Page) {
    super(page);
    this.paragraphContainer = page.locator('.paragraph-container').first();
    this.addParagraphAbove = page.locator('zeppelin-notebook-add-paragraph').first();
    this.addParagraphBelow = page.locator('zeppelin-notebook-add-paragraph').last();
    this.controlPanels = page.locator('zeppelin-notebook-paragraph-control');
    this.controlPanel = this.controlPanels.first();
    this.codeEditor = page.locator('zeppelin-notebook-paragraph-code-editor').first();
    this.dynamicForms = page.locator('zeppelin-notebook-paragraph-dynamic-forms').first();
    this.resultDisplay = page.locator('zeppelin-notebook-paragraph-result').first();
    this.footerInfo = page.locator('zeppelin-notebook-paragraph-footer').first();
    this.runButton = page
      .locator('.paragraph-container')
      .first()
      .locator(
        'button[nzTooltipTitle*="Run"], button[title*="Run"], button:has-text("Run"), .run-button, [aria-label*="Run"], i[nzType="play-circle"]:visible, button:has(i[nzType="play-circle"])'
      )
      .first();
    this.settingsDropdown = page
      .locator('.paragraph-container')
      .first()
      .locator('zeppelin-notebook-paragraph-control a[nz-dropdown]')
      .first();
    this.status = this.controlPanel.locator('.status');
    // The control renders the cancel icon only while the paragraph is PENDING or RUNNING.
    this.cancelButton = this.controlPanel.locator('.cancel-para');
    // The export controls render only for a TABLE result.
    this.exportDropdownTrigger = this.resultDisplay.locator('.export-dropdown-icon-btn');
    this.exportMenu = page.locator('.ant-dropdown-menu');
    // ng-zorro renders the menu items as plain list items, so there is no role to look them up by.
    this.checkInterpreterHealthItem = page.getByTestId('check-interpreter-health');
    this.interpreterHealthStatus = this.checkInterpreterHealthItem.getByTestId('interpreter-health');
    // The badge is ng-zorro's: the dot pulses only for a check under way, and the text is the label.
    this.interpreterHealthPulse = this.interpreterHealthStatus.locator('.ant-badge-status-processing');
    this.interpreterHealthLabel = this.interpreterHealthStatus.locator('.ant-badge-status-text');
    this.noInterpreterHint = this.checkInterpreterHealthItem.getByText('No interpreter', { exact: true });
  }

  // The export dropdown is declared without nzTrigger, so ng-zorro opens it on hover, not click.
  async openExportMenu(): Promise<void> {
    await this.exportDropdownTrigger.hover();
    await expect(this.exportMenu).toBeVisible();
  }

  async doubleClickToEdit(): Promise<void> {
    await this.paragraphContainer.dblclick();
  }

  async runParagraph(): Promise<void> {
    await this.runButton.click();
  }

  async openSettingsDropdown(paragraphIndex = 0): Promise<void> {
    await this.controlPanels.nth(paragraphIndex).locator('a[nz-dropdown]').click();
  }

  // A menu that opens upwards or is pushed up by the edge of the screen can cover its own gear, so it
  // is closed with the keyboard.
  async closeSettingsDropdown(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.checkInterpreterHealthItem).toBeHidden();
  }

  // The interpreter bindings arrive over the WebSocket after the note, and the item stays disabled
  // under the hint until they do.
  async checkInterpreterHealth(): Promise<void> {
    await this.openSettingsDropdown();
    await expect(this.checkInterpreterHealthItem).toBeVisible();
    await expect(this.noInterpreterHint).toBeHidden();
    await this.checkInterpreterHealthItem.click();
  }
}
