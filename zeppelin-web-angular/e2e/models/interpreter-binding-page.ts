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
  readonly healthBadges: Locator;

  constructor(page: Page) {
    super(page);
    this.panel = page.locator('zeppelin-notebook-interpreter-binding');
    this.interpreterBoxes = this.panel.locator('.interpreter-box');
    this.healthBadges = this.panel.getByTestId('interpreter-health-badge');
  }

  async open(): Promise<void> {
    await new NotebookActionBarPage(this.page).interpreterSettingsButton.click();
    await expect(this.panel).toBeVisible();
  }

  boxOf(interpreterName: string): Locator {
    return this.interpreterBoxes.filter({
      has: this.page.locator('.main-name').getByText(interpreterName, { exact: true })
    });
  }

  badgeOf(interpreterName: string): Locator {
    return this.boxOf(interpreterName).getByTestId('interpreter-health-badge');
  }
}
