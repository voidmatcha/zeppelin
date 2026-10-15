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

import { expect, test, Page } from '@playwright/test';
import { InterpreterBindingPage } from '../../../models/interpreter-binding-page';
import {
  expectDetailsAbove,
  healthyInterpreter,
  idleInterpreter,
  mockInterpreterBindings,
  mockInterpreterHealthCheck,
  mockInterpreterHealthCheckForbidden,
  notRunningInterpreter,
  unreachableInterpreter,
  BoundInterpreter,
  HealthCheckRequest
} from '../../../models/interpreter-health.util';
import { NotebookParagraphPage } from '../../../models/notebook-paragraph-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  performLoginIfRequired,
  waitForZeppelinReady,
  PAGES
} from '../../../utils';

// The ids differ from the names on purpose: the panel shows the names and the server is asked by the ids.
const ALPHA: BoundInterpreter = { id: 'id-alpha', name: 'alpha' };
const BETA: BoundInterpreter = { id: 'id-beta', name: 'beta' };

test.describe('Notebook Interpreter Binding - Health Check', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_INTERPRETER_BINDING);

  let bindingPage: InterpreterBindingPage;
  let testNotebook: { noteId: string; paragraphId: string };

  // A mock of the interpreter bindings only reaches a WebSocket that opens after it, so it has to be
  // in place before the page is first loaded here.
  const openPanel = async (page: Page) => {
    bindingPage = new InterpreterBindingPage(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);

    testNotebook = await createTestNotebook(page);
    await page.goto(`/#/notebook/${testNotebook.noteId}`);
    await bindingPage.open();
    await expect(bindingPage.interpreterBoxes.first()).toBeVisible();
  };

  test.describe('on the real server', () => {
    test.beforeEach(async ({ page }) => {
      await openPanel(page);
    });

    test('Given the bound interpreters, When listing them, Then each one has its own check button', async () => {
      const interpreterCount = await bindingPage.interpreterBoxes.count();

      await expect(bindingPage.checkHealthButtons).toHaveCount(interpreterCount);
      await expect(bindingPage.healthStatusOf(bindingPage.interpreterBoxes.first())).toHaveText('');
    });

    test('Given an interpreter answers, When checking it, Then its row shows it as healthy', async ({ page }) => {
      await test.step('Given an interpreter that answers', async () => {
        await mockInterpreterHealthCheck(page, healthyInterpreter);
      });

      await test.step('When checking it', async () => {
        await bindingPage.checkHealthButtons.first().click();
      });

      await test.step('Then its row shows it as healthy', async () => {
        await expect(bindingPage.healthStatusOf(bindingPage.interpreterBoxes.first())).toHaveText('Healthy');
      });
    });

    test('Given no process is running, When checking an interpreter, Then it is neutral and not an error', async ({
      page
    }) => {
      await test.step('Given a setting that holds no process, as after a restart', async () => {
        await mockInterpreterHealthCheck(page, notRunningInterpreter);
      });

      await test.step('When checking it', async () => {
        await bindingPage.checkHealthButtons.first().click();
      });

      await test.step('Then it is neutral and not an error', async () => {
        await expect(bindingPage.healthStatusOf(bindingPage.interpreterBoxes.first())).toHaveText('Not running');
        await expect(bindingPage.errorMessage).toHaveCount(0);
      });
    });

    test('Given a process that was never started, When checking an interpreter, Then it is neutral and not an error', async ({
      page
    }) => {
      await test.step('Given a setting that was never used, which is what a new note gets', async () => {
        await mockInterpreterHealthCheck(page, idleInterpreter);
      });

      await test.step('When checking it', async () => {
        await bindingPage.checkHealthButtons.first().click();
      });

      await test.step('Then it is neutral and not an error', async () => {
        await expect(bindingPage.healthStatusOf(bindingPage.interpreterBoxes.first())).toHaveText('Not running');
        await expect(bindingPage.errorMessage).toHaveCount(0);
      });
    });

    test('Given an interpreter does not answer, When checking it, Then it is shown as unhealthy', async ({ page }) => {
      await test.step('Given a process that exists but does not answer', async () => {
        await mockInterpreterHealthCheck(page, unreachableInterpreter);
      });

      await test.step('When checking it', async () => {
        await bindingPage.checkHealthButtons.first().click();
      });

      await test.step('Then it is shown as unhealthy, with the reason', async () => {
        const status = bindingPage.healthStatusOf(bindingPage.interpreterBoxes.first());
        await expect(status).toHaveText('Unhealthy');
        await status.hover();
        await expect(
          page.getByText('shared_process: Process exists but does not answer', { exact: true })
        ).toBeVisible();
      });
    });

    test('Given an interpreter does not answer, When hovering its status, Then the details open above it', async ({
      page
    }) => {
      const status = () => bindingPage.healthStatusOf(bindingPage.interpreterBoxes.first());

      await test.step('Given a status in a row', async () => {
        await mockInterpreterHealthCheck(page, unreachableInterpreter);
        await bindingPage.checkHealthButtons.first().click();
        await expect(status()).toHaveText('Unhealthy');
      });

      await test.step('When hovering the status', async () => {
        await status().hover();
      });

      await test.step('Then the details open above it, clear of the controls of the row', async () => {
        await expectDetailsAbove(page, status());
      });
    });

    test('Given the server refuses the check, When checking an interpreter, Then the reason is shown', async ({
      page
    }) => {
      await test.step('Given the web server turns the caller away with a bare Forbidden', async () => {
        await mockInterpreterHealthCheckForbidden(page, 'Forbidden');
      });

      await test.step('When checking an interpreter', async () => {
        await bindingPage.checkHealthButtons.first().click();
      });

      await test.step('Then the reason is shown in words, and the row has no status', async () => {
        await expect(
          bindingPage.errorMessage.getByText('No privilege to check the interpreter health', { exact: true })
        ).toBeVisible();
        await expect(bindingPage.healthStatusOf(bindingPage.interpreterBoxes.first())).toHaveText('');
      });
    });
  });

  test.describe('with two bound interpreters', () => {
    let requests: HealthCheckRequest[] = [];

    test.beforeEach(async ({ page }) => {
      await mockInterpreterBindings(page, [ALPHA, BETA]);
      requests = await mockInterpreterHealthCheck(page, healthyInterpreter);
      await openPanel(page);
      await expect(bindingPage.interpreterBoxes).toHaveCount(2);
    });

    test('Given two interpreters are bound, When checking one, Then only its row and its setting are involved', async () => {
      await test.step('Given two interpreters, each with its own button', async () => {
        await expect(bindingPage.checkHealthButtonOf('alpha')).toBeVisible();
        await expect(bindingPage.checkHealthButtonOf('beta')).toBeVisible();
      });

      await test.step('When checking the second one', async () => {
        await bindingPage.checkHealthButtonOf('beta').click();
      });

      await test.step('Then only its row shows a status, and its setting is asked by its id', async () => {
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('beta'))).toHaveText('Healthy');
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('alpha'))).toHaveText('');
        expect(requests).toEqual([{ method: 'POST', settingId: 'id-beta', noteId: testNotebook.noteId }]);
      });
    });

    test('Given a check under way, When pressing the button again, Then the button keeps the focus and it is one request', async ({
      page
    }) => {
      let releaseAnswers: () => void = () => undefined;
      const answersReleased = new Promise<void>(resolve => {
        releaseAnswers = resolve;
      });

      await test.step('Given a check that is not answered yet', async () => {
        requests = await mockInterpreterHealthCheck(page, healthyInterpreter, answersReleased);
        await bindingPage.checkHealthButtonOf('alpha').focus();
        await page.keyboard.press('Enter');
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('alpha'))).toHaveText('Checking');
      });

      await test.step('When pressing the button again', async () => {
        await page.keyboard.press('Enter');
      });

      await test.step('Then the button never lost the focus, and it is still one request', async () => {
        await expect(bindingPage.checkHealthButtonOf('alpha')).toBeFocused();
        releaseAnswers();
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('alpha'))).toHaveText('Healthy');
        await expect(bindingPage.checkHealthButtonOf('alpha')).toBeFocused();
        expect(requests).toHaveLength(1);
      });
    });

    test('Given an answer is shown, When restarting the interpreter, Then the answer is dropped and a late one is ignored', async ({
      page
    }) => {
      let releaseAnswers: () => void = () => undefined;
      const answersReleased = new Promise<void>(resolve => {
        releaseAnswers = resolve;
      });

      await test.step('Given an answer for alpha, and a check of beta that is not answered yet', async () => {
        await bindingPage.checkHealthButtonOf('alpha').click();
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('alpha'))).toHaveText('Healthy');
        await page.unroute('**/api/interpreter/setting/*/healthcheck');
        await mockInterpreterHealthCheck(page, healthyInterpreter, answersReleased);
        await bindingPage.checkHealthButtonOf('beta').click();
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('beta'))).toHaveText('Checking');
        await page.route('**/api/interpreter/setting/restart/*', route =>
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK' }) })
        );
      });

      await test.step('When restarting both', async () => {
        await bindingPage.restart('alpha');
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('alpha'))).toHaveText('');
        await bindingPage.restart('beta');
      });

      await test.step('Then neither shows an answer, not even the one that comes after the restart', async () => {
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('beta'))).toHaveText('');
        releaseAnswers();
        await expect(bindingPage.checkHealthButtonOf('beta')).toBeEnabled();
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('beta'))).toHaveText('');
        await expect(bindingPage.healthStatusOf(bindingPage.boxOf('alpha'))).toHaveText('');
      });
    });

    test('Given an edit that is not saved, When cancelling the panel, Then the paragraphs still go by the saved default', async ({
      page
    }) => {
      const paragraphPage = new NotebookParagraphPage(page);

      await test.step('Given the default interpreter unbound in the panel, which is then cancelled', async () => {
        await bindingPage.toggleBinding('alpha');
        await bindingPage.cancel();
      });

      await test.step('When checking the health of a paragraph without a directive', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it still asks the saved default, not the next one', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
        expect(requests).toEqual([{ method: 'POST', settingId: 'id-alpha', noteId: testNotebook.noteId }]);
      });
    });
  });
});
