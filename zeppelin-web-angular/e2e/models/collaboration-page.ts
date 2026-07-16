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
import { waitForZeppelinReady } from '../utils';
import { BasePage } from './base-page';

export class CollaborationPage extends BasePage {
  readonly paragraph: Locator;
  readonly editor: Locator;
  readonly editorText: Locator;
  readonly collaborationButton: Locator;
  readonly personalizedButton: Locator;

  constructor(page: Page) {
    super(page);
    this.paragraph = page.locator('zeppelin-notebook-paragraph').first();
    this.editor = this.paragraph.locator('.monaco-editor').first();
    this.editorText = this.paragraph.locator('.view-lines').first();
    this.collaborationButton = page.getByRole('button', { name: 'Collaboration' });
    this.personalizedButton = page.getByRole('button', { name: 'Personalized' });
  }

  async openNotebook(noteId: string): Promise<void> {
    await this.page.goto(`/#/notebook/${noteId}`);
    await waitForZeppelinReady(this.page);
    await expect(this.paragraph).toBeVisible({ timeout: 15000 });
  }

  async switchToCollaborationModeIfAvailable(): Promise<void> {
    if (await this.collaborationButton.isVisible().catch(() => false)) {
      await this.collaborationButton.click();
      await expect(this.personalizedButton).toBeVisible({ timeout: 15000 });
    }
  }

  async typeInEditor(text: string): Promise<void> {
    await this.editor.click();
    await this.page.keyboard.type(text);
  }
}
