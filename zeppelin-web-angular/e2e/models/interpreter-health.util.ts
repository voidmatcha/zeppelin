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
import { E2E_TEST_FOLDER } from './base-page';

// Mirrors the body of POST /api/interpreter/setting/{settingId}/healthcheck (InterpreterHealthCheck.java).
// The mocks below stand in for a server whose interpreters can be made unhealthy on demand.
interface HealthCheckGroup {
  groupId: string;
  healthy: boolean;
  reason: 'OK' | 'NOT_REACHABLE' | 'PROBE_TIMEOUT' | 'LAUNCHING' | 'NOT_RUNNING';
  alive?: boolean;
  running?: boolean;
  probeTookMs: number;
}

export interface HealthCheckResult {
  reason?: 'NOT_RUNNING';
  groups: HealthCheckGroup[];
}

export interface HealthCheckRequest {
  method: string;
  settingId: string;
  noteId?: string;
}

const healthCheckResult = (...groups: HealthCheckGroup[]): HealthCheckResult => ({ groups });

const sharedProcess = (settingId: string) => `${settingId}-shared_process`;

export const healthyInterpreter = (settingId: string): HealthCheckResult =>
  healthCheckResult({
    groupId: sharedProcess(settingId),
    healthy: true,
    reason: 'OK',
    alive: true,
    running: true,
    probeTookMs: 3
  });

export const unreachableInterpreter = (settingId: string): HealthCheckResult =>
  healthCheckResult({
    groupId: sharedProcess(settingId),
    healthy: false,
    reason: 'NOT_REACHABLE',
    alive: true,
    running: false,
    probeTookMs: 1004
  });

export const timedOutInterpreter = (settingId: string): HealthCheckResult =>
  healthCheckResult({
    groupId: sharedProcess(settingId),
    healthy: false,
    reason: 'PROBE_TIMEOUT',
    probeTookMs: 3000
  });

/** The answer for a setting that was closed, for example by a restart: it holds no process at all. */
export const notRunningInterpreter = (): HealthCheckResult => ({ reason: 'NOT_RUNNING', groups: [] });

/** The answer for a setting that was never used: its group exists, but it has no process yet. */
export const idleInterpreter = (settingId: string): HealthCheckResult =>
  healthCheckResult({ groupId: sharedProcess(settingId), healthy: false, reason: 'NOT_RUNNING', probeTookMs: 0 });

export const launchingInterpreter = (settingId: string): HealthCheckResult =>
  healthCheckResult({ groupId: sharedProcess(settingId), healthy: false, reason: 'LAUNCHING', probeTookMs: 0 });

/** One process answers and one is gone, as with a setting that runs a process for every user. */
export const partlyUnhealthyInterpreter = (settingId: string): HealthCheckResult =>
  healthCheckResult(
    { groupId: `${settingId}-alice`, healthy: true, reason: 'OK', alive: true, running: true, probeTookMs: 4 },
    {
      groupId: `${settingId}-bob`,
      healthy: false,
      reason: 'NOT_REACHABLE',
      alive: false,
      running: false,
      probeTookMs: 9
    }
  );

/** A process for each of `count` users, all of which answer. */
export const crowdedInterpreter =
  (count: number) =>
  (settingId: string): HealthCheckResult =>
    healthCheckResult(
      ...Array.from({ length: count }, (_, index) => ({
        groupId: `${settingId}-user${index + 1}`,
        healthy: true,
        reason: 'OK' as const,
        alive: true,
        running: true,
        probeTookMs: 2
      }))
    );

const settingIdOf = (url: string): string => {
  const [, settingId] = /\/interpreter\/setting\/([^/]+)\/healthcheck$/.exec(new URL(url).pathname) ?? [];
  return settingId;
};

/**
 * Answers every health check with the result built for the asked setting, and records the requests.
 * Only a POST is answered, as the server does; anything else goes on to the server and fails there.
 * With `release`, the answers wait for it, which keeps a check under way for as long as a test needs.
 */
export const mockInterpreterHealthCheck = async (
  page: Page,
  respond: (settingId: string) => HealthCheckResult,
  release?: Promise<unknown>
): Promise<HealthCheckRequest[]> => {
  const requests: HealthCheckRequest[] = [];
  await page.route('**/api/interpreter/setting/*/healthcheck', async route => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    const settingId = settingIdOf(request.url());
    requests.push({ method: request.method(), settingId, ...request.postDataJSON() });
    await release;
    // The page may have given up on the request while it was held, and then there is nobody to answer.
    await route
      .fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'OK',
          message: '',
          body: { settingId, settingName: 'mocked-interpreter', ...respond(settingId) }
        })
      })
      .catch(() => undefined);
  });
  return requests;
};

/**
 * Refuses every health check the way the server does when the caller may not act on the note. The
 * web server in front of it can do the same before the endpoint is reached, and then it only says
 * 'Forbidden', so the message is the test's to choose.
 */
export const mockInterpreterHealthCheckForbidden = async (page: Page, message: string): Promise<void> => {
  await page.route('**/api/interpreter/setting/*/healthcheck', route =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'FORBIDDEN', message })
    })
  );
};

/** An interpreter setting as the server lists it among the bindings of a note. */
export interface BoundInterpreter {
  id: string;
  name: string;
  /** Its interpreters, the first of which is its default. They are named like the setting by default. */
  interpreters?: string[];
}

/**
 * Answers the interpreter bindings of every note with the given settings, all bound. A note that asks
 * again gets the next list, and the last one goes on being answered. The page has to open its
 * WebSocket after this, which a reload does. Which interpreters a server has depends on how it was
 * built, so a test that needs several of them cannot take them from the server.
 *
 * Returns the ids of the notes the bindings were asked for.
 */
export const mockInterpreterBindings = async (page: Page, ...lists: BoundInterpreter[][]): Promise<string[]> => {
  const asked: string[] = [];
  await page.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    ws.onMessage(message => {
      const sent = typeof message === 'string' ? JSON.parse(message) : undefined;
      if (sent?.op === 'GET_INTERPRETER_BINDINGS') {
        asked.push(sent.data.noteId);
      }
      server.send(message);
    });
    server.onMessage(message => {
      const received = typeof message === 'string' ? JSON.parse(message) : undefined;
      if (received?.op !== 'INTERPRETER_BINDINGS') {
        ws.send(message);
        return;
      }
      const bound = lists[Math.min(asked.length, lists.length) - 1] ?? lists[0];
      const interpreterBindings = bound.map(({ id, name, interpreters = [name] }) => ({
        id,
        name,
        selected: true,
        interpreters: interpreters.map((interpreter, index) => ({
          name: interpreter,
          class: `org.apache.zeppelin.e2e.${interpreter}`,
          defaultInterpreter: index === 0
        }))
      }));
      ws.send(JSON.stringify({ ...received, data: { ...received.data, interpreterBindings } }));
    });
  });
  return asked;
};

/**
 * Expects the details of a status, which a hover opened, to lie above it. Beside it they would cover
 * the control of the row the status sits in, which is at the edge of the screen.
 */
export const expectDetailsAbove = async (page: Page, status: Locator): Promise<void> => {
  const details = page.getByText(/^Checked at /);
  await expect(details).toBeVisible();
  await expect
    .poll(async () => {
      const [detailsBox, statusBox] = [await details.boundingBox(), await status.boundingBox()];
      return detailsBox && statusBox ? statusBox.y - (detailsBox.y + detailsBox.height) : undefined;
    })
    .toBeGreaterThanOrEqual(0);
};

/** Creates a note, in the folder the cleanup of the e2e notes looks at, with a paragraph for each text. */
export const createNotebookWithParagraphs = async (page: Page, texts: string[]): Promise<{ noteId: string }> => {
  const notePath = `${E2E_TEST_FOLDER}/InterpreterHealth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/notebook', {
    data: { notePath, paragraphs: texts.map(text => ({ text })) },
    failOnStatusCode: false
  });
  if (!response.ok()) {
    throw new Error(`Create notebook REST request failed: ${response.status()} ${await response.text()}`);
  }
  const { body: noteId } = (await response.json()) as { body: string };
  return { noteId };
};
