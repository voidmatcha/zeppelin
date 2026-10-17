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

import { expect, test, Locator, Page } from '@playwright/test';
import {
  BoundInterpreter,
  HealthCheckRequest,
  createNotebookWithParagraphs,
  healthyInterpreter,
  idleInterpreter,
  launchingInterpreter,
  mockInterpreterBindings,
  mockInterpreterHealthCheck,
  mockInterpreterHealthCheckForbidden,
  notRunningInterpreter,
  partlyUnhealthyInterpreter,
  timedOutInterpreter,
  unreachableInterpreter
} from '../../../models/interpreter-health.util';
import { NotebookParagraphPage } from '../../../models/notebook-paragraph-page';
import { addPageAnnotationBeforeEach, performLoginIfRequired, waitForZeppelinReady, PAGES } from '../../../utils';

// The ids differ from the names on purpose: a directive names a setting, and the server is asked by its id.
const ALPHA: BoundInterpreter = { id: 'id-alpha', name: 'alpha', interpreters: ['alpha', 'sql'] };
const BETA: BoundInterpreter = { id: 'id-beta', name: 'beta' };

const STATE_OF: Array<{ name: string; respond: Parameters<typeof mockInterpreterHealthCheck>[1]; state: string }> = [
  { name: 'answers', respond: healthyInterpreter, state: 'healthy' },
  { name: 'is alive but does not answer', respond: unreachableInterpreter, state: 'unhealthy' },
  { name: 'times out', respond: timedOutInterpreter, state: 'unhealthy' },
  { name: 'is starting', respond: launchingInterpreter, state: 'starting' },
  { name: 'was never used', respond: idleInterpreter, state: 'not-running' },
  { name: 'was closed by a restart', respond: () => notRunningInterpreter(), state: 'not-running' }
];

test.describe('Notebook Paragraph - Interpreter health chip', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_INTERPRETER_HEALTH_CHIP);

  let paragraphPage: NotebookParagraphPage;

  // The interpreter bindings arrive over a WebSocket that a mock only reaches if it opens after the mock, so the
  // notebook is created first and opened last.
  const openNotebook = async (page: Page, texts: string[], bindings: BoundInterpreter[] = [ALPHA, BETA]) => {
    paragraphPage = new NotebookParagraphPage(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    const { noteId } = await createNotebookWithParagraphs(page, texts);
    await mockInterpreterBindings(page, bindings);
    await page.goto(`/#/notebook/${noteId}`);
    // A mock of the WebSocket only reaches a connection that opens after it, and moving within the SPA keeps the old one.
    await page.reload();
    await expect(paragraphPage.paragraphContainers.first()).toBeVisible({ timeout: 30000 });
    return noteId;
  };

  test('Given a paragraph, When the notebook opens, Then its chip is not checked and nothing was asked', async ({
    page
  }) => {
    const requests: HealthCheckRequest[] = await mockInterpreterHealthCheck(page, healthyInterpreter);
    await openNotebook(page, ['%alpha\nselect 1', '%beta\nselect 1']);

    await test.step('Then each paragraph has a chip that was not checked', async () => {
      await expect(paragraphPage.healthChips).toHaveCount(2);
      for (const chip of await paragraphPage.healthChips.all()) {
        await expect(chip).toHaveAttribute('data-state', 'unknown');
      }
    });

    await test.step('And the server was not asked (a check is a click)', async () => {
      expect(requests).toEqual([]);
    });
  });

  test('Given two paragraphs of two settings, When one chip is clicked, Then the setting of that paragraph is asked', async ({
    page
  }) => {
    const noteId = await openNotebook(page, ['%alpha\nselect 1', '%beta\nselect 1']);
    const requests = await mockInterpreterHealthCheck(page, healthyInterpreter);

    await paragraphPage.healthChips.nth(1).click();

    await expect(paragraphPage.healthChips.nth(1)).toHaveAttribute('data-state', 'healthy');
    await expect(paragraphPage.healthChips.nth(0)).toHaveAttribute('data-state', 'unknown');
    expect(requests).toEqual([{ method: 'POST', settingId: 'id-beta', noteId }]);
  });

  for (const { name, respond, state } of STATE_OF) {
    test(`Given the interpreter ${name}, When checking its health, Then the chip is ${state}`, async ({ page }) => {
      await openNotebook(page, ['%alpha\nselect 1']);
      await mockInterpreterHealthCheck(page, respond);

      await paragraphPage.healthChips.first().click();

      await expect(paragraphPage.healthChips.first()).toHaveAttribute('data-state', state);
      if (state === 'unhealthy') {
        // the bar in the dot is what tells unhealthy from healthy without the colour
        const bar = await paragraphPage.healthChips
          .first()
          .locator('.dot')
          .evaluate(dot => getComputedStyle(dot, '::after').height);
        expect(bar, 'the dot of an unhealthy interpreter carries a bar').toBe('5px');
      }
    });
  }

  test('Given an unhealthy interpreter, When hovering its chip, Then the tooltip says why and when', async ({
    page
  }) => {
    await openNotebook(page, ['%alpha\nselect 1']);
    await mockInterpreterHealthCheck(page, partlyUnhealthyInterpreter);
    await paragraphPage.healthChips.first().click();
    await expect(paragraphPage.healthChips.first()).toHaveAttribute('data-state', 'unhealthy');

    await paragraphPage.healthChips.first().hover();

    await expect(paragraphPage.healthTooltip).toContainText('alpha: Unhealthy');
    await expect(paragraphPage.healthTooltip).toContainText('bob: Process is gone');
    await expect(paragraphPage.healthTooltip).toContainText(/Checked at /);
    await expect(paragraphPage.healthTooltip).toContainText('Click to check again');
  });

  test('Given a check under way, When clicking again, Then only one request is made and the chip is checking', async ({
    page
  }) => {
    await openNotebook(page, ['%alpha\nselect 1']);
    let release!: () => void;
    const requests = await mockInterpreterHealthCheck(page, healthyInterpreter, new Promise<void>(r => (release = r)));

    await paragraphPage.healthChips.first().click();
    await expect(paragraphPage.healthChips.first()).toHaveAttribute('data-state', 'checking');
    await paragraphPage.healthChips.first().click();
    release();

    await expect(paragraphPage.healthChips.first()).toHaveAttribute('data-state', 'healthy');
    expect(requests).toHaveLength(1);
  });

  test('Given the server refuses, When checking, Then the reason is shown and the chip is not checked again', async ({
    page
  }) => {
    await openNotebook(page, ['%alpha\nselect 1']);
    await mockInterpreterHealthCheckForbidden(page, 'Forbidden');

    await paragraphPage.healthChips.first().click();

    await expect(paragraphPage.errorMessage).toContainText('No privilege to check the interpreter health');
    await expect(paragraphPage.healthChips.first()).toHaveAttribute('data-state', 'unknown');
  });

  test('Given a paragraph of an interpreter that is not bound, When the notebook opens, Then it has no chip', async ({
    page
  }) => {
    await openNotebook(page, ['%gamma\nselect 1', '%alpha\nselect 1']);

    await expect(paragraphPage.healthChips).toHaveCount(1);
    // an empty footer without a chip is as small as it was: 12px of margin, not the 30px a chip needs
    const row = await paragraphPage.paragraphContainers.first().locator('.footer-row').boundingBox();
    expect(row!.height).toBeLessThan(20);
  });

  test('Given a keyboard user, When focusing the chip, Then the tooltip opens and Escape closes it', async ({
    page
  }) => {
    await openNotebook(page, ['%alpha\nselect 1']);
    const chip = paragraphPage.healthChips.first();

    await chip.focus();
    await expect(paragraphPage.healthTooltip).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(paragraphPage.healthTooltip).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test('Given the settings icon of a paragraph, When the chip is drawn, Then its dot is centered under that icon, in the corner', async ({
    page
  }) => {
    await openNotebook(page, ['%alpha\nselect 1']);
    const container = paragraphPage.paragraphContainers.first();
    const centerX = async (locator: Locator) => {
      const box = (await locator.boundingBox())!;
      return box.x + box.width / 2;
    };

    const gear = await centerX(container.locator('zeppelin-notebook-paragraph-control i[nztype="setting"]'));
    const dot = await centerX(container.locator('zeppelin-notebook-interpreter-health-chip .dot'));
    const [card, chip] = [
      await container.locator('.paragraph').boundingBox(),
      await paragraphPage.healthChips.first().boundingBox()
    ];

    expect(Math.abs(dot - gear), 'dot and settings icon on one vertical line').toBeLessThanOrEqual(1);
    expect(card!.y + card!.height - (chip!.y + chip!.height), 'close to the bottom edge').toBeLessThanOrEqual(8);
  });

  test('Given a paragraph, When it is drawn, Then the chip sits at the right end of the footer row inside the card', async ({
    page
  }) => {
    await openNotebook(page, ['%alpha\nselect 1']);
    const card = paragraphPage.paragraphContainers.first().locator('.paragraph');
    const row = paragraphPage.paragraphContainers.first().locator('.footer-row');
    const chip = paragraphPage.healthChips.first();

    const [cardBox, rowBox, chipBox] = [await card.boundingBox(), await row.boundingBox(), await chip.boundingBox()];

    expect(rowBox!.height).toBeGreaterThanOrEqual(30);
    expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    expect(chipBox!.x + chipBox!.width).toBeGreaterThan(rowBox!.x + rowBox!.width - 24);
    expect(chipBox!.y).toBeGreaterThanOrEqual(rowBox!.y);
    // the chip reaches 6px below the row, into the padding of the card, to sit in the corner
    expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height + 7);
  });
});
