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
  readonly legacyNotebook: Locator;

  constructor(private readonly page: Page) {
    this.entry = page.getByTestId('react-notebook-entry');
    this.noteHeading = this.entry.getByRole('heading', { level: 1 });
    this.paragraphs = this.entry.getByTestId('react-notebook-paragraph');
    this.permissions = this.entry.getByRole('region', { name: 'Notebook permissions' });
    this.editor = this.entry.getByRole('textbox');
    this.writeControls = this.entry.getByRole('button', { name: /^(run|save|delete|add paragraph)$/i });
    this.fallback = new NotebookCoreReadPage(page);
    this.legacyNotebook = this.fallback.legacyNotebook;
  }

  async open(noteId: string): Promise<void> {
    await this.page.goto(`/#/notebook/${noteId}?notebookReactPrivate=true`);
  }

  async openDefault(noteId: string): Promise<void> {
    await this.page.goto(`/#/notebook/${noteId}`);
  }

  defaultTitle(name: string): Locator {
    return this.legacyNotebook.getByText(name, { exact: true }).first();
  }
}
