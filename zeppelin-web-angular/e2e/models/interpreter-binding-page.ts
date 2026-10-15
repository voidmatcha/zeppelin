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
import { NotebookActionBarPage } from './notebook-action-bar-page';

export class InterpreterBindingPage extends BasePage {
  readonly panel: Locator;
  readonly interpreterBoxes: Locator;
  readonly checkHealthButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.panel = page.locator('zeppelin-notebook-interpreter-binding');
    this.interpreterBoxes = this.panel.locator('.interpreter-box');
    this.checkHealthButtons = this.panel.getByRole('button', { name: /^Check health of / });
  }

  async open(): Promise<void> {
    await new NotebookActionBarPage(this.page).interpreterSettingsButton.click();
    await expect(this.panel).toBeVisible();
  }

  checkHealthButtonOf(interpreterName: string): Locator {
    return this.panel.getByRole('button', { name: `Check health of ${interpreterName}`, exact: true });
  }

  healthStatusOf(box: Locator): Locator {
    return box.getByTestId('interpreter-health');
  }

  boxOf(interpreterName: string): Locator {
    // The inner locator is looked up inside each box, so it must not start at the panel.
    return this.interpreterBoxes.filter({
      has: this.page.getByRole('button', { name: `Check health of ${interpreterName}`, exact: true })
    });
  }

  // Clicking the name of an interpreter binds it or unbinds it, until the panel is saved.
  async toggleBinding(interpreterName: string): Promise<void> {
    await this.boxOf(interpreterName).locator('.interpreter-name button').click();
  }

  async cancel(): Promise<void> {
    await this.panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(this.panel).toBeHidden();
  }

  // The restart is asked to be confirmed in a modal.
  async restart(interpreterName: string): Promise<void> {
    await this.boxOf(interpreterName).locator('a.refresh').click();
    await this.okButton.click();
  }
}
