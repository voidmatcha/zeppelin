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
  createNotebookWithParagraphs,
  crowdedInterpreter,
  expectDetailsAbove,
  healthyInterpreter,
  idleInterpreter,
  launchingInterpreter,
  mockInterpreterBindings,
  mockInterpreterHealthCheck,
  mockInterpreterHealthCheckForbidden,
  notRunningInterpreter,
  partlyUnhealthyInterpreter,
  timedOutInterpreter,
  unreachableInterpreter,
  BoundInterpreter,
  HealthCheckRequest
} from '../../../models/interpreter-health.util';
import { NotebookParagraphPage } from '../../../models/notebook-paragraph-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  performLoginIfRequired,
  setParagraphText,
  waitForZeppelinReady,
  PAGES
} from '../../../utils';

// The ids differ from the names on purpose: a directive names a setting, and the server is asked by its id.
const ALPHA: BoundInterpreter = { id: 'id-alpha', name: 'alpha', interpreters: ['alpha', 'sql'] };
const BETA: BoundInterpreter = { id: 'id-beta', name: 'beta' };

// What the server runs a paragraph on, by its text, with alpha as the default setting.
const ASKED_SETTING: Array<{ text: string; asks: string; why: string }> = [
  { text: 'select 1', asks: 'id-alpha', why: 'no directive, so the default setting' },
  { text: '%beta\nselect 1', asks: 'id-beta', why: 'a setting named by the directive' },
  { text: '%alpha.sql\nselect 1', asks: 'id-alpha', why: 'an interpreter of a setting, in full' },
  { text: '%sql\nselect 1', asks: 'id-alpha', why: 'an interpreter of the default setting, on its own' },
  { text: '%beta.beta\nselect 1', asks: 'id-beta', why: 'the interpreter of another setting, in full' },
  { text: '%alpha.conf\nspark.master=local', asks: 'id-alpha', why: 'the configuration of a setting' },
  { text: '%conf\nspark.master=local', asks: 'id-alpha', why: 'the configuration of the default setting' },
  { text: '  \t%beta(a=1)\nselect 1', asks: 'id-beta', why: 'blanks and local properties around the directive' },
  { text: ' %beta\nselect 1', asks: 'id-alpha', why: 'a no-break space, which the server does not skip' }
];
const NOTHING_TO_ASK: Array<{ text: string; why: string }> = [
  { text: '%beta.sql\nselect 1', why: 'an interpreter that another setting owns' },
  { text: '%gamma\nselect 1', why: 'an unknown setting' },
  { text: '%alpha.sql.more\nselect 1', why: 'a name of three parts' }
];

test.describe('Notebook Paragraph - Interpreter Health Check', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_PARAGRAPH_CONTROL);

  let paragraphPage: NotebookParagraphPage;
  let testNotebook: { noteId: string; paragraphId: string };

  // A mock of the interpreter bindings only reaches a WebSocket that opens after it, so it has to be
  // in place before the page is first loaded here.
  const signIn = async (page: Page) => {
    paragraphPage = new NotebookParagraphPage(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
  };

  const createNotebook = async (page: Page) => {
    await signIn(page);
    testNotebook = await createTestNotebook(page);
  };

  const openNotebook = async (page: Page, noteId: string) => {
    await page.goto(`/#/notebook/${noteId}`);
    await expect(paragraphPage.paragraphContainer).toBeVisible({ timeout: 30000 });
  };

  test.describe('verdicts', () => {
    test.beforeEach(async ({ page }) => {
      await createNotebook(page);
      await openNotebook(page, testNotebook.noteId);
    });

    test('Given the interpreter answers, When checking its health, Then it is shown as healthy', async ({ page }) => {
      await test.step('Given the interpreter answers', async () => {
        await mockInterpreterHealthCheck(page, healthyInterpreter);
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it is shown as healthy', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
      });
    });

    test('Given a setting that holds no process, When checking its health, Then it is neutral and not an error', async ({
      page
    }) => {
      await test.step('Given a setting that was closed, as by a restart', async () => {
        await mockInterpreterHealthCheck(page, notRunningInterpreter);
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it is neutral and not an error', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Not running');
        await expect(paragraphPage.errorMessage).toHaveCount(0);
      });
    });

    test('Given a process that was never started, When checking its health, Then it is neutral and says it starts on use', async ({
      page
    }) => {
      await test.step('Given a setting that was never used, which is what a new note gets', async () => {
        await mockInterpreterHealthCheck(page, idleInterpreter);
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it is neutral, and the details say why', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Not running');
        await expect(paragraphPage.errorMessage).toHaveCount(0);
        await paragraphPage.interpreterHealthStatus.hover();
        await expect(page.getByText('shared_process: Not running', { exact: true })).toBeVisible();
        await expect(page.getByText('It starts on first use.', { exact: true })).toBeVisible();
      });
    });

    test('Given an interpreter that is starting, When checking its health, Then it is shown as starting', async ({
      page
    }) => {
      await test.step('Given an interpreter that is still launching', async () => {
        await mockInterpreterHealthCheck(page, launchingInterpreter);
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it is shown as starting, standing still and not as an error', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Starting');
        await expect(paragraphPage.interpreterHealthPulse).toHaveCount(0);
        await expect(paragraphPage.errorMessage).toHaveCount(0);
      });
    });

    test('Given the interpreter does not answer, When checking its health, Then it is shown as unhealthy', async ({
      page
    }) => {
      await test.step('Given a process that exists but does not answer', async () => {
        await mockInterpreterHealthCheck(page, unreachableInterpreter);
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it is shown as unhealthy, with the reason', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Unhealthy');
        await paragraphPage.interpreterHealthStatus.hover();
        await expect(
          page.getByText('shared_process: Process exists but does not answer', { exact: true })
        ).toBeVisible();
      });
    });

    test('Given the probe runs out of time, When checking its health, Then it is shown as unhealthy', async ({
      page
    }) => {
      await test.step('Given a probe that is not answered in time', async () => {
        await mockInterpreterHealthCheck(page, timedOutInterpreter);
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it is shown as unhealthy, with the reason', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Unhealthy');
        await paragraphPage.interpreterHealthStatus.hover();
        await expect(page.getByText('shared_process: No answer within 3000 ms', { exact: true })).toBeVisible();
      });
    });

    test('Given one of two processes is gone, When checking its health, Then it is unhealthy and the failing one comes first', async ({
      page
    }) => {
      await test.step('Given a healthy process and a process that is gone', async () => {
        await mockInterpreterHealthCheck(page, partlyUnhealthyInterpreter);
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then the failing one outweighs the healthy one, and is listed first', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Unhealthy');
        await paragraphPage.interpreterHealthStatus.hover();
        const lines = page.getByText(/^(alice|bob): /);
        await expect(lines).toHaveText(['bob: Process is gone', 'alice: Answered in 4 ms']);
      });
    });

    test('Given a process for every user, When checking its health, Then the details are cut short', async ({
      page
    }) => {
      await test.step('Given twelve processes that answer', async () => {
        await mockInterpreterHealthCheck(page, crowdedInterpreter(12));
      });

      await test.step('When checking its health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then eight are listed and the rest is counted', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
        await paragraphPage.interpreterHealthStatus.hover();
        await expect(page.getByText(/^user\d+: /)).toHaveCount(8);
        await expect(page.getByText('and 4 more', { exact: true })).toBeVisible();
      });
    });

    test('Given an answer is shown, When hovering it, Then the details open above it', async ({ page }) => {
      await test.step('Given an answer in the menu', async () => {
        await mockInterpreterHealthCheck(page, unreachableInterpreter);
        await paragraphPage.checkInterpreterHealth();
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Unhealthy');
      });

      await test.step('When hovering it', async () => {
        await paragraphPage.interpreterHealthStatus.hover();
      });

      await test.step('Then the details open above it, clear of the label of the item', async () => {
        await expectDetailsAbove(page, paragraphPage.interpreterHealthStatus);
      });
    });

    test('Given the server refuses the check, When checking the health, Then the reason is shown and no status is', async ({
      page
    }) => {
      await test.step('Given the web server turns the caller away with a bare Forbidden', async () => {
        await mockInterpreterHealthCheckForbidden(page, 'Forbidden');
      });

      await test.step('When checking the health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then the reason is shown in words, and no status is', async () => {
        await expect(
          paragraphPage.errorMessage.getByText('No privilege to check the interpreter health', { exact: true })
        ).toBeVisible();
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('');
      });
    });
  });

  test.describe('the check', () => {
    test.beforeEach(async ({ page }) => {
      await createNotebook(page);
      await openNotebook(page, testNotebook.noteId);
    });

    test('Given a note, When checking the health, Then the request names the note to authorize against', async ({
      page
    }) => {
      let requests: HealthCheckRequest[] = [];

      await test.step('Given a note', async () => {
        requests = await mockInterpreterHealthCheck(page, healthyInterpreter);
      });

      await test.step('When checking the health', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then it is a POST that names the note', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].noteId).toBe(testNotebook.noteId);
      });
    });

    test('Given a check under way, When clicking again, Then it is one request and the item says it is checking', async ({
      page
    }) => {
      let releaseAnswers: () => void = () => undefined;
      const answersReleased = new Promise<void>(resolve => {
        releaseAnswers = resolve;
      });
      let requests: HealthCheckRequest[] = [];

      await test.step('Given a check that is not answered yet', async () => {
        requests = await mockInterpreterHealthCheck(page, healthyInterpreter, answersReleased);
        await paragraphPage.checkInterpreterHealth();
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Checking');
      });

      await test.step('When clicking the item again', async () => {
        await paragraphPage.checkInterpreterHealthItem.dispatchEvent('click');
      });

      await test.step('Then it is still one request, and the answer is shown once it comes', async () => {
        releaseAnswers();
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
        expect(requests).toHaveLength(1);
      });
    });

    test('Given an answer is shown, When opening the menu again, Then it asks nothing and shows no old answer', async ({
      page
    }) => {
      let requests: HealthCheckRequest[] = [];

      await test.step('Given a menu that showed an answer', async () => {
        requests = await mockInterpreterHealthCheck(page, healthyInterpreter);
        await paragraphPage.checkInterpreterHealth();
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
      });

      await test.step('When closing the menu and opening it again', async () => {
        await paragraphPage.closeSettingsDropdown();
        await paragraphPage.openSettingsDropdown();
      });

      await test.step('Then the menu starts clean, and nothing was asked again', async () => {
        await expect(paragraphPage.checkInterpreterHealthItem).toBeVisible();
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('');
        expect(requests).toHaveLength(1);
      });
    });
  });

  test.describe('on the real server', () => {
    test.beforeEach(async ({ page }) => {
      await createNotebook(page);
      await setParagraphText(page, testNotebook.noteId, testNotebook.paragraphId, '%python\nprint(1)');
      await openNotebook(page, testNotebook.noteId);
    });

    test('Given a python paragraph, When checking its health, Then the request reaches the endpoint and a verdict comes back', async ({
      page
    }) => {
      const asked: string[] = [];
      page.on('request', request => {
        if (request.url().endsWith('/healthcheck')) {
          asked.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
      });

      await test.step('When checking the health, without a mock in between', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then the server answered with a verdict, whatever the python process is doing', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText(/^(Healthy|Not running|Starting)$/);
        await expect(paragraphPage.errorMessage).toHaveCount(0);
        expect(asked).toEqual(['POST /api/interpreter/setting/python/healthcheck']);
      });
    });
  });

  test.describe('which setting is asked', () => {
    test.beforeEach(async ({ page }) => {
      await mockInterpreterBindings(page, [ALPHA, BETA]);
      await signIn(page);
    });

    test('Given a paragraph for each kind of directive, When checking each, Then the setting the server runs it on is asked', async ({
      page
    }) => {
      let requests: HealthCheckRequest[] = [];
      let noteId = '';

      await test.step('Given two bound interpreters and a note with a paragraph for each kind of directive', async () => {
        requests = await mockInterpreterHealthCheck(page, healthyInterpreter);
        ({ noteId } = await createNotebookWithParagraphs(page, [
          ...ASKED_SETTING.map(({ text }) => text),
          ...NOTHING_TO_ASK.map(({ text }) => text)
        ]));
        await openNotebook(page, noteId);
        await expect(paragraphPage.controlPanels).toHaveCount(ASKED_SETTING.length + NOTHING_TO_ASK.length);
      });

      for (const [index, { text, asks, why }] of ASKED_SETTING.entries()) {
        await test.step(`When checking ${why} (${JSON.stringify(text.split('\n')[0])}), Then ${asks} is asked`, async () => {
          await paragraphPage.openSettingsDropdown(index);
          await expect(paragraphPage.noInterpreterHint).toBeHidden();
          await paragraphPage.checkInterpreterHealthItem.click();
          await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
          expect(requests).toHaveLength(index + 1);
          expect(requests[index]).toEqual({ method: 'POST', settingId: asks, noteId });
          await paragraphPage.closeSettingsDropdown();
        });
      }

      for (const [offset, { text, why }] of NOTHING_TO_ASK.entries()) {
        await test.step(`When checking ${why} (${JSON.stringify(text.split('\n')[0])}), Then there is nothing to check`, async () => {
          await paragraphPage.openSettingsDropdown(ASKED_SETTING.length + offset);
          await expect(paragraphPage.noInterpreterHint).toBeVisible();
          await paragraphPage.checkInterpreterHealthItem.click();
          await expect(paragraphPage.interpreterHealthStatus).toHaveCount(0);
          expect(requests).toHaveLength(ASKED_SETTING.length);
          await paragraphPage.closeSettingsDropdown();
        });
      }
    });
  });

  test.describe('which setting is asked when it was bound after the note was loaded', () => {
    test('Given a paragraph that came to use a setting after the note was loaded, When opening the menu, Then the bindings are asked for again', async ({
      page
    }) => {
      let bindingsAsked: string[] = [];
      let requests: HealthCheckRequest[] = [];

      await test.step('Given a note loaded with alpha, and a paragraph that uses beta', async () => {
        bindingsAsked = await mockInterpreterBindings(page, [ALPHA], [ALPHA, BETA]);
        requests = await mockInterpreterHealthCheck(page, healthyInterpreter);
        await createNotebook(page);
        await setParagraphText(page, testNotebook.noteId, testNotebook.paragraphId, '%beta\nselect 1');
        await openNotebook(page, testNotebook.noteId);
        expect(bindingsAsked).toEqual([testNotebook.noteId]);
      });

      await test.step('When opening the menu and checking', async () => {
        await paragraphPage.checkInterpreterHealth();
      });

      await test.step('Then beta is asked, with no reload in between', async () => {
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Healthy');
        expect(bindingsAsked).toEqual([testNotebook.noteId, testNotebook.noteId]);
        expect(requests).toEqual([{ method: 'POST', settingId: 'id-beta', noteId: testNotebook.noteId }]);
      });
    });
  });

  test.describe('dark theme', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('zeppelin-theme', 'dark'));
      await createNotebook(page);
      await openNotebook(page, testNotebook.noteId);
    });

    test('Given the dark theme, When checking the health, Then the status is as small as its label and fits the row', async ({
      page
    }) => {
      await test.step('Given an interpreter that is not running, whose status is the longest', async () => {
        await mockInterpreterHealthCheck(page, idleInterpreter);
      });

      await test.step('When checking the health', async () => {
        await paragraphPage.checkInterpreterHealth();
        await expect(paragraphPage.interpreterHealthStatus).toHaveText('Not running');
      });

      await test.step('Then the status has the font size of the menu and does not wrap', async () => {
        await expect(paragraphPage.interpreterHealthLabel).toHaveCSS('font-size', '12px');
        const label = paragraphPage.checkInterpreterHealthItem.getByText('Check interpreter health');
        const status = paragraphPage.interpreterHealthStatus;
        const [labelBox, statusBox] = [await label.boundingBox(), await status.boundingBox()];
        expect(Math.abs(labelBox!.y + labelBox!.height / 2 - (statusBox!.y + statusBox!.height / 2))).toBeLessThan(8);
      });
    });
  });
});
