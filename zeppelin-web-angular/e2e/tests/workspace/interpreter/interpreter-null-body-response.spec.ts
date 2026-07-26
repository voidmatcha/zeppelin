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

import { expect, test } from '@playwright/test';
import { InterpreterRepositoryModal } from '../../../models/interpreter-repository-modal';
import { addPageAnnotationBeforeEach, waitForZeppelinReady, PAGES } from '../../../utils';

// ZEPPELIN-6522: a 204 reaches the interceptor as `event.body === null`; the old `event.body.body`
// unwrap threw and dropped the success. Repository-add's success handler only closes the modal, so
// a stubbed 204 makes the modal the pass/fail signal.
test.describe('AppHttpInterceptor - null-body response', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.INTERPRETER_CREATE_REPO);

  test('an empty (204) response resolves the request instead of crashing the interceptor', async ({ page }) => {
    await page.goto('/#/interpreter');
    await waitForZeppelinReady(page);

    // Force the null-body response the guard protects; stub the POST only.
    await page.route('**/api/interpreter/repository', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.continue();
    });

    const modal = new InterpreterRepositoryModal(page);
    await modal.openCreateModal();
    await modal.fillRepository({ id: 'e2e-null-body-repo', url: 'repo1.maven.org/maven2/' });
    await modal.submit();

    // Success closes the modal; the unguarded build errors the stream and leaves it open.
    await expect(modal.idInput).toBeHidden({ timeout: 15000 });
  });
});
