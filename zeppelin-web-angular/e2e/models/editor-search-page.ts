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

export class EditorSearchPage extends BasePage {
  readonly editor: Locator;
  readonly editorText: Locator;
  readonly findWidget: Locator;
  readonly findInput: Locator;
  readonly replaceInput: Locator;
  readonly matchesCount: Locator;
  readonly nextMatchButton: Locator;
  readonly previousMatchButton: Locator;
  readonly toggleReplaceButton: Locator;
  readonly replaceAllButton: Locator;

  constructor(page: Page) {
    super(page);
    this.editor = page.locator('zeppelin-notebook-paragraph .monaco-editor').first();
    this.editorText = this.editor.locator('.view-lines').first();
    this.findWidget = this.editor.locator('.find-widget').first();
    this.findInput = this.findWidget
      .locator('.monaco-findInput .input, input[aria-label="Find"], textarea[aria-label="Find"]')
      .first();
    this.replaceInput = this.findWidget
      .locator('.replace-input .input, input[aria-label="Replace"], textarea[aria-label="Replace"]')
      .first();
    this.matchesCount = this.findWidget.locator('.matchesCount').first();
    this.nextMatchButton = this.findWidget.locator('.button.next, [title^="Next Match"]').first();
    this.previousMatchButton = this.findWidget.locator('.button.previous, [title^="Previous Match"]').first();
    this.toggleReplaceButton = this.findWidget.locator('.button.toggle, [title^="Toggle Replace"]').first();
    this.replaceAllButton = this.findWidget.locator('.button.replace-all, [title^="Replace All"]').first();
  }

  async openNotebook(noteId: string): Promise<void> {
    await this.page.goto(`/#/notebook/${noteId}`);
    await waitForZeppelinReady(this.page);
    await expect(this.editor).toBeVisible({ timeout: 15000 });
  }

  async setEditorContent(content: string): Promise<void> {
    await this.editor.click();
    const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await this.page.keyboard.press(selectAll);
    await this.page.keyboard.insertText(content);
    await expect(this.editorText).toContainText(content.split('\n')[0], { timeout: 15000 });
  }

  async openFindWidget(): Promise<void> {
    await this.editor.click();
    // 'Home' anchors the find widget on the first match: after seeding, the
    // cursor sits at the end and Monaco would report the last match as current.
    // It works under every browser project regardless of the platform keymap
    // Monaco detects (webkit emulates a mac UA, where Control+Home is a no-op),
    // and the seeded content is single-line, so line start == document start.
    await this.page.keyboard.press('Home');
    await this.page.keyboard.press('Control+S');
    await expect(this.findWidget).toBeVisible({ timeout: 15000 });
  }

  async searchFor(text: string): Promise<void> {
    await this.findInput.fill(text);
    await expect(this.matchesCount).toBeVisible({ timeout: 15000 });
  }
}
