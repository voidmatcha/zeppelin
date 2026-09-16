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

import { Browser, expect, Page, test } from '@playwright/test';
import { JobManagerPage } from 'e2e/models/job-manager-page';
import { collectRuntimeErrors, expectNoNoteNameAccessError } from 'e2e/models/job-manager-page.util';
import { LoginPage } from 'e2e/models/login-page';
import { LoginTestUtil, TestCredentials } from 'e2e/models/login-page.util';
import { addPageAnnotationBeforeEach, PAGES } from '../../../utils';

interface NoteJob {
  noteId?: string;
  isRunningJob?: boolean;
  isRemoved?: boolean;
  unixTimeLastRun?: number;
}

interface JobManagerMessage {
  op?: string;
  data?: {
    noteRunningJobs?: { jobs?: NoteJob[] };
  };
}

const ZEPPELIN_WS_URL_PATTERN = /\/ws(\?|$)/;

class JobManagerMessageRecorder {
  private readonly messages: JobManagerMessage[] = [];
  private readonly sentOperations: string[] = [];

  static async install(page: Page): Promise<JobManagerMessageRecorder> {
    const recorder = new JobManagerMessageRecorder();

    await page.routeWebSocket(ZEPPELIN_WS_URL_PATTERN, socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => {
        recorder.recordSentOperation(message.toString());
        server.send(message);
      });
      server.onMessage(message => {
        recorder.record(message.toString());
        socket.send(message);
      });
    });

    return recorder;
  }

  hasSubscriptionRequest(): boolean {
    return this.sentOperations.includes('LIST_NOTE_JOBS');
  }

  hasSubscriptionResponse(): boolean {
    return this.messages.some(message => message.op === 'LIST_NOTE_JOBS');
  }

  removals(noteIds: ReadonlySet<string>): NoteJob[] {
    return this.messages
      .filter(message => message.op === 'LIST_UPDATE_NOTE_JOBS')
      .flatMap(message => message.data?.noteRunningJobs?.jobs ?? [])
      .filter(job => job.isRemoved === true && typeof job.noteId === 'string' && noteIds.has(job.noteId));
  }

  private record(payload: string): void {
    const message = parseMessage(payload);
    if (message) {
      this.messages.push(message);
    }
  }

  private recordSentOperation(payload: string): void {
    const message = parseMessage(payload);
    if (message?.op) {
      this.sentOperations.push(message.op);
    }
  }
}

const parseMessage = (payload: string): JobManagerMessage | undefined => {
  try {
    const message: unknown = JSON.parse(payload);
    return typeof message === 'object' && message !== null ? (message as JobManagerMessage) : undefined;
  } catch {
    return undefined;
  }
};

const createNote = async (page: Page, label: string): Promise<{ noteId: string; noteName: string }> => {
  const noteName = `EventBusParity_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/notebook', {
    data: {
      notePath: `E2E_TEST_FOLDER/${noteName}`,
      defaultInterpreterGroup: 'python',
      addingEmptyParagraph: true
    },
    failOnStatusCode: false
  });
  await expect(response).toBeOK();

  const body = (await response.json()) as { body?: string };
  expect(body.body).toEqual(expect.any(String));
  return { noteId: body.body as string, noteName };
};

const deleteNote = async (page: Page, noteId: string): Promise<void> => {
  const response = await page.request.delete(`/api/notebook/${noteId}`, { failOnStatusCode: false });
  await expect(response).toBeOK();
};

const expectNoteMissing = async (page: Page, noteId: string): Promise<void> => {
  await expect
    .poll(async () => (await page.request.get(`/api/notebook/${noteId}`, { failOnStatusCode: false })).status())
    .toBe(404);
};

const login = async (page: Page, credentials: TestCredentials): Promise<void> => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await expect(loginPage.formContainer).toBeVisible();
  await loginPage.login(credentials.username, credentials.password);
  await expect(loginPage.formContainer).toBeHidden();
};

const expectServerEventBusMode = async (page: Page): Promise<void> => {
  // Retries connection errors while the freshly started daemon is still booting.
  await expect(async () => {
    // Requires the admin role under Shiro; CI grants it to user1.
    const response = await page.request.get('/api/configurations/prefix/zeppelin.eventbus.enabled', {
      failOnStatusCode: false
    });
    await expect(response).toBeOK();

    const body = (await response.json()) as { body?: Record<string, string> };
    expect(body.body?.['zeppelin.eventbus.enabled']).toBe(
      process.env.ZEPPELIN_EVENTBUS_ENABLED === 'true' ? 'true' : 'false'
    );
  }).toPass({ timeout: 180_000 });
};

const subscribeToJobUpdates = async (
  jobManager: JobManagerPage,
  recorder: JobManagerMessageRecorder
): Promise<void> => {
  await jobManager.navigate();
  await expect.poll(() => recorder.hasSubscriptionRequest()).toBe(true);
  await expect.poll(() => recorder.hasSubscriptionResponse(), { timeout: 120_000 }).toBe(true);
};

const verifyRemovalParity = async (
  browser: Browser,
  ownerPage: Page,
  observerCredentials: TestCredentials | undefined,
  observerOwnsNotes: boolean
): Promise<{ ownerRemovalCount: number; observerRemovalCount: number }> => {
  const ownerRecorder = await JobManagerMessageRecorder.install(ownerPage);
  const ownerErrors = collectRuntimeErrors(ownerPage);
  await expectServerEventBusMode(ownerPage);
  const targetNote = await createNote(ownerPage, 'target');
  const barrierNote = await createNote(ownerPage, 'barrier');
  const observerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const observerPage = await observerContext.newPage();
  const observerRecorder = await JobManagerMessageRecorder.install(observerPage);
  const observerErrors = collectRuntimeErrors(observerPage);

  try {
    if (observerCredentials) {
      await login(observerPage, observerCredentials);
    }

    const ownerJobManager = new JobManagerPage(ownerPage);
    const observerJobManager = new JobManagerPage(observerPage);

    await Promise.all([
      subscribeToJobUpdates(ownerJobManager, ownerRecorder),
      subscribeToJobUpdates(observerJobManager, observerRecorder)
    ]);

    await expect(ownerJobManager.jobItemByName(targetNote.noteName)).toBeVisible();
    await expect(ownerJobManager.jobItemByName(barrierNote.noteName)).toBeVisible();
    await observerJobManager.filterByNoteName(targetNote.noteName);
    await expect(observerJobManager.jobItemByName(targetNote.noteName)).toHaveCount(observerOwnsNotes ? 1 : 0);
    await expect(observerJobManager.emptyState).toHaveCount(observerOwnsNotes ? 0 : 1);

    await deleteNote(ownerPage, targetNote.noteId);
    await expectNoteMissing(ownerPage, targetNote.noteId);
    await deleteNote(ownerPage, barrierNote.noteId);
    await expectNoteMissing(ownerPage, barrierNote.noteId);

    const expectedRemovalOrder = [targetNote.noteId, barrierNote.noteId];
    const ownedNoteIds = new Set(expectedRemovalOrder);
    await expect.poll(() => ownerRecorder.removals(ownedNoteIds).map(job => job.noteId)).toEqual(expectedRemovalOrder);
    await expect
      .poll(() => observerRecorder.removals(ownedNoteIds).map(job => job.noteId))
      .toEqual(expectedRemovalOrder);
    for (const recorder of [ownerRecorder, observerRecorder]) {
      expect(recorder.removals(ownedNoteIds)).toEqual([
        { noteId: targetNote.noteId, isRunningJob: false, isRemoved: true, unixTimeLastRun: 0 },
        { noteId: barrierNote.noteId, isRunningJob: false, isRemoved: true, unixTimeLastRun: 0 }
      ]);
    }

    await expect(ownerJobManager.jobItemByName(targetNote.noteName)).toHaveCount(0);
    await expect(ownerJobManager.jobItemByName(barrierNote.noteName)).toHaveCount(0);
    await expect(observerJobManager.jobItemByName(targetNote.noteName)).toHaveCount(0);
    await expect(observerJobManager.emptyState).toBeVisible();
    expectNoNoteNameAccessError(ownerErrors);
    expectNoNoteNameAccessError(observerErrors);

    return {
      ownerRemovalCount: ownerRecorder.removals(ownedNoteIds).length,
      observerRemovalCount: observerRecorder.removals(ownedNoteIds).length
    };
  } finally {
    await observerContext.close();
    await ownerPage.request.delete(`/api/notebook/${targetNote.noteId}`, { failOnStatusCode: false });
    await ownerPage.request.delete(`/api/notebook/${barrierNote.noteId}`, { failOnStatusCode: false });
  }
};

test.describe('Job Manager note-removal EventBus parity', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.JOB_MANAGER);

  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      process.env.ZEPPELIN_EVENTBUS_PARITY_ENABLED !== 'true',
      'ZEPPELIN-6698 requires the dedicated EventBus parity matrix'
    );
    test.skip(browserName !== 'chromium', 'The server WebSocket contract is browser-independent');
    testInfo.annotations.push({
      type: 'eventbus-mode',
      description: process.env.ZEPPELIN_EVENTBUS_ENABLED === 'true' ? 'eventbus' : 'legacy'
    });
  });

  test('anonymous viewers receive one ordered removal payload per deleted note', async ({ browser, page }) => {
    test.skip(await LoginTestUtil.isShiroEnabled(), 'ZEPPELIN-6698 requires the anonymous server matrix');
    const removalCounts = await verifyRemovalParity(browser, page, undefined, true);
    expect(removalCounts).toEqual({ ownerRemovalCount: 2, observerRemovalCount: 2 });
  });

  test('an authenticated non-owner receives one ordered removal payload per deleted note', async ({
    browser,
    page
  }) => {
    test.skip(!(await LoginTestUtil.isShiroEnabled()), 'ZEPPELIN-6698 requires the authenticated server matrix');
    const credentials = await LoginTestUtil.getTestCredentials();
    expect(credentials.user2).toBeDefined();
    const removalCounts = await verifyRemovalParity(browser, page, credentials.user2, false);
    // Pins the existing JOB_MANAGER_PAGE broadcast; an authorization filter must update this expectation.
    expect(removalCounts).toEqual({ ownerRemovalCount: 2, observerRemovalCount: 2 });
  });
});
