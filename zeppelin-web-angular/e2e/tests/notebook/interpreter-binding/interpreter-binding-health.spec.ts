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
import {
  BoundInterpreter,
  createNotebookWithParagraphs,
  healthyInterpreter,
  mockInterpreterBindings,
  mockInterpreterHealthCheck,
  mockInterpreterHealthCheckForbidden,
  notRunningInterpreter,
  partlyUnhealthyInterpreter,
  unreachableInterpreter
} from '../../../models/interpreter-health.util';
import { InterpreterBindingPage } from '../../../models/interpreter-binding-page';
import { addPageAnnotationBeforeEach, performLoginIfRequired, waitForZeppelinReady, PAGES } from '../../../utils';

const ALPHA: BoundInterpreter = { id: 'id-alpha', name: 'alpha', interpreters: ['alpha', 'sql'] };
const BETA: BoundInterpreter = { id: 'id-beta', name: 'beta' };

test.describe('Notebook Interpreter Binding - Health badge', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_INTERPRETER_HEALTH_BADGE);

  let bindingPage: InterpreterBindingPage;

  const openPanel = async (page: Page) => {
    bindingPage = new InterpreterBindingPage(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    const { noteId } = await createNotebookWithParagraphs(page, ['%alpha\nselect 1']);
    await mockInterpreterBindings(page, [ALPHA, BETA]);
    await page.goto(`/#/notebook/${noteId}`);
    // A mock of the WebSocket only reaches a connection that opens after it, and moving within the SPA keeps the old one.
    await page.reload();
    await expect(page.locator('.paragraph-container').first()).toBeVisible({ timeout: 30000 });
    await bindingPage.open();
    return noteId;
  };

  test('Given the panel, When it opens, Then each row has a badge at its right end, no Check health button, and nothing was asked', async ({
    page
  }) => {
    const requests = await mockInterpreterHealthCheck(page, healthyInterpreter);
    await openPanel(page);

    await expect(bindingPage.healthBadges).toHaveCount(2);
    await expect(bindingPage.panel.getByText('Check health')).toHaveCount(0);
    await expect(bindingPage.badgeOf('alpha')).toContainText('Not checked');
    for (const box of await bindingPage.interpreterBoxes.all()) {
      const [boxRect, badgeRect] = [
        await box.boundingBox(),
        await box.getByTestId('interpreter-health-badge').boundingBox()
      ];
      expect(Math.round(boxRect!.x + boxRect!.width - (badgeRect!.x + badgeRect!.width))).toBeLessThanOrEqual(1);
    }
    expect(requests).toEqual([]);
  });

  test('Given the panel, When clicking a badge, Then only that setting is asked and its badge says Healthy', async ({
    page
  }) => {
    const requests = await mockInterpreterHealthCheck(page, healthyInterpreter);
    const noteId = await openPanel(page);

    await bindingPage.badgeOf('beta').click();

    await expect(bindingPage.badgeOf('beta')).toContainText('Healthy');
    await expect(bindingPage.badgeOf('alpha')).toContainText('Not checked');
    expect(requests).toEqual([{ method: 'POST', settingId: 'id-beta', noteId }]);
  });

  test('Given an unhealthy setting, When checking, Then the reason is written in the row and the time is the title', async ({
    page
  }) => {
    await mockInterpreterHealthCheck(page, unreachableInterpreter);
    await openPanel(page);

    await bindingPage.badgeOf('alpha').click();

    await expect(bindingPage.badgeOf('alpha')).toContainText('Unhealthy | No answer');
    await expect(bindingPage.badgeOf('alpha')).toHaveAttribute('title', /^Checked at /);
    // the bar in the dot is what tells unhealthy from healthy without the colour
    const bar = await bindingPage
      .badgeOf('alpha')
      .locator('.dot')
      .evaluate(dot => getComputedStyle(dot, '::after').height);
    expect(bar, 'the dot of an unhealthy setting carries a bar').toBe('4px');
  });

  test('Given a setting with several processes, When one is gone, Then the badge counts the failing ones', async ({
    page
  }) => {
    await mockInterpreterHealthCheck(page, partlyUnhealthyInterpreter);
    await openPanel(page);

    await bindingPage.badgeOf('alpha').click();

    await expect(bindingPage.badgeOf('alpha')).toContainText('Unhealthy | Process gone (1 of 2)');
  });

  test('Given a setting that holds no process, When checking, Then it says it starts on use and is no error', async ({
    page
  }) => {
    await mockInterpreterHealthCheck(page, () => notRunningInterpreter());
    await openPanel(page);

    await bindingPage.badgeOf('alpha').click();

    await expect(bindingPage.badgeOf('alpha')).toContainText('Not running | starts on use');
    await expect(bindingPage.errorMessage).toHaveCount(0);
  });

  test('Given the server refuses, When checking, Then the reason is shown and the badge is not checked again', async ({
    page
  }) => {
    await mockInterpreterHealthCheckForbidden(page, 'Forbidden');
    await openPanel(page);

    await bindingPage.badgeOf('alpha').click();

    await expect(bindingPage.errorMessage).toContainText('No privilege to check the interpreter health');
    await expect(bindingPage.badgeOf('alpha')).toContainText('Not checked');
  });

  test('Given a narrow screen, When the panel is open, Then nothing overflows sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mockInterpreterHealthCheck(page, unreachableInterpreter);
    await openPanel(page);
    await bindingPage.badgeOf('alpha').click();
    await expect(bindingPage.badgeOf('alpha')).toContainText('Unhealthy');

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    }));

    expect(width.scroll).toBeLessThanOrEqual(width.client);
  });
});
