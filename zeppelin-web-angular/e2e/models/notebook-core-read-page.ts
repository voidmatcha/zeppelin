/*
 * Licensed under the Apache Software Foundation (ASF) under one or more
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
import { BasePage } from './base-page';

export class NotebookCoreReadPage extends BasePage {
  readonly readView: Locator;
  readonly noteHeading: Locator;
  readonly notFoundAlert: Locator;
  readonly legacyNotebook: Locator;

  constructor(page: Page) {
    super(page);
    this.readView = page.getByTestId('notebook-core-read');
    this.noteHeading = this.readView.getByRole('heading', { level: 1 });
    this.notFoundAlert = this.readView.getByRole('alert').getByText('Notebook not found.', { exact: true });
    this.legacyNotebook = page.locator('zeppelin-notebook');
  }

  async open(noteId: string, revisionId?: string, readOnly = true): Promise<void> {
    const revision = revisionId ? `/revision/${revisionId}` : '';
    const query = readOnly ? '?notebookCoreReadOnly=true' : '';
    await this.page.goto(`/#/notebook/${noteId}${revision}${query}`);
  }

  async changeRoute(noteId: string, revisionId?: string): Promise<void> {
    const revision = revisionId ? `/revision/${revisionId}` : '';
    await this.page.evaluate(hash => {
      window.location.hash = hash;
    }, `#/notebook/${noteId}${revision}?notebookCoreReadOnly=true`);
  }
}
