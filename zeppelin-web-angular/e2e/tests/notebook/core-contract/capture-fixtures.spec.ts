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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';
import { WebSocketServer, type WebSocket as ServerWebSocket } from 'ws';

import {
  createNotebookTransportRecorder,
  createPlaywrightFixtureAdapter,
  validateFixture
} from '../../../core-contract/notebook-transport-fixture.mjs';
import {
  createNotebookLifecycleRecorder,
  validateLifecycleContractCoverage,
  validateLifecycleFixture
} from '../../../core-contract/notebook-lifecycle-fixture.mjs';
import { fixtureMetadata } from '../../../core-contract/fixture-doubles.mjs';
import { E2E_TEST_FOLDER } from '../../../models/base-page';
import { LoginTestUtil } from '../../../models/login-page.util';
import {
  addPageAnnotationBeforeEach,
  createNotebookViaRest,
  navigateToNotebookWithFallback,
  PAGES,
  performLoginIfRequired,
  waitForZeppelinReady
} from '../../../utils';

// Exercise real Playwright transport objects; fixture logic is covered by the Node suite.

const notebookRequest = {
  bodyRaw: '',
  headers: { accept: 'application/json' },
  method: 'GET',
  url: '/api/notebook/note-a'
};

const liveCaptureProvenance = (
  page: import('@playwright/test').Page,
  browserName: string,
  configuration: Record<string, boolean | number | string>,
  interpreter = 'not-used'
) => {
  const sourceCommit = process.env.ZEPPELIN_E2E_SOURCE_COMMIT;
  const baseCommit = process.env.ZEPPELIN_E2E_BASE_COMMIT;
  const buildManifestPath = process.env.ZEPPELIN_E2E_BUILD_MANIFEST;
  if (!sourceCommit) throw new Error('ZEPPELIN_E2E_SOURCE_COMMIT is required for live fixture capture');
  if (!baseCommit) throw new Error('ZEPPELIN_E2E_BASE_COMMIT is required for live fixture capture');
  if (!buildManifestPath) throw new Error('ZEPPELIN_E2E_BUILD_MANIFEST is required for live fixture capture');
  const manifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
  if (manifest.sourceCommit !== sourceCommit) throw new Error('build manifest source does not match capture source');
  return {
    baseCommit,
    authentication: process.env.ZEPPELIN_E2E_CAPTURE_AUTHENTICATION ?? 'anonymous',
    browser: { name: browserName, version: page.context().browser()!.version() },
    buildManifest: {
      artifacts: manifest.artifacts,
      baseCommit: manifest.baseCommit,
      id: manifest.manifestId,
      launchTargets: manifest.launchTargets,
      sourceCommit: manifest.sourceCommit,
      sourceTree: manifest.sourceTree,
      version: manifest.version
    },
    captureMode: process.env.ZEPPELIN_E2E_CAPTURE_MODE ?? 'lifecycle',
    configuration,
    interpreter,
    isolation: {
      logs: '<capture-root>/logs',
      notebook: '<capture-root>/notebook',
      pid: '<capture-root>/run',
      recovery: '<capture-root>/recovery',
      root: '<capture-root>',
      searchIndex: '<capture-root>/index'
    },
    origin: new URL(page.url()).origin,
    sourceCommit
  };
};

const liveCaptureMode = process.env.ZEPPELIN_E2E_CAPTURE_MODE;

const replayFixture = () => ({
  metadata: fixtureMetadata(),
  records: [
    { kind: 'rest', sequence: 1, rest: { direction: 'request', request: notebookRequest } },
    {
      kind: 'rest',
      sequence: 2,
      rest: {
        bodyJson: { id: 'note-a' },
        direction: 'response',
        headers: { 'content-type': 'application/json' },
        request: notebookRequest,
        status: 200
      }
    },
    {
      kind: 'websocket',
      sequence: 3,
      websocket: { direction: 'send', payloadText: '{"op":"GET_NOTE","msgId":"<msgId:1>"}' }
    },
    {
      kind: 'websocket',
      sequence: 4,
      websocket: { direction: 'receive', payloadText: '{"op":"NOTE","noteId":"note-a","msgId":"<msgId:1>"}' }
    }
  ],
  version: 1
});

type RawLifecycleMessage = { data?: Record<string, unknown>; msgId?: string; op: string };
type RawLifecycleWindow = Window & {
  lifecycleMessages: RawLifecycleMessage[];
  lifecycleSequence: number;
  lifecycleSocket: WebSocket;
  lifecycleTicket: { principal: string; roles: string; ticket: string };
};

const openRawLifecycleSocket = async (page: import('@playwright/test').Page, origin: string) => {
  await page.goto(`${origin}/api/version`);
  await page.evaluate(async () => {
    const lifecycle = window as unknown as RawLifecycleWindow;
    const ticketResponse = await (await fetch('/api/security/ticket')).json();
    lifecycle.lifecycleTicket = ticketResponse.body;
    lifecycle.lifecycleMessages = [];
    lifecycle.lifecycleSequence = 0;
    lifecycle.lifecycleSocket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
    lifecycle.lifecycleSocket.onmessage = event => lifecycle.lifecycleMessages.push(JSON.parse(String(event.data)));
    await new Promise<void>((resolve, reject) => {
      lifecycle.lifecycleSocket.onopen = () => resolve();
      lifecycle.lifecycleSocket.onerror = () => reject(new Error('Notebook WebSocket failed to open'));
    });
  });
};

const sendRawLifecycleMessage = async (
  page: import('@playwright/test').Page,
  op: string,
  data?: Record<string, unknown>,
  expectedOp?: string
) =>
  page.evaluate(
    async ({ data, expectedOp, op }) => {
      const lifecycle = window as unknown as RawLifecycleWindow;
      const start = lifecycle.lifecycleMessages.length;
      lifecycle.lifecycleSocket.send(
        JSON.stringify({
          data,
          msgId: `lifecycle-${++lifecycle.lifecycleSequence}`,
          op,
          ...lifecycle.lifecycleTicket
        })
      );
      if (!expectedOp) return undefined;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const match = lifecycle.lifecycleMessages.slice(start).find(message => message.op === expectedOp);
        if (match) return match;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for ${expectedOp} after ${op}`);
    },
    { data, expectedOp, op }
  );

const waitForRawLifecycleMessage = async (page: import('@playwright/test').Page, op: string, start = 0) =>
  page.evaluate(
    async ({ op, start }) => {
      const lifecycle = window as unknown as RawLifecycleWindow;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const match = lifecycle.lifecycleMessages.slice(start).find(message => message.op === op);
        if (match) return match;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for ${op}`);
    },
    { op, start }
  );

// Serve a test page without a Zeppelin server.
const servePage = (page: import('@playwright/test').Page) =>
  page.route('http://fixture.test/', route =>
    route.fulfill({ body: '<html><body>fixture</body></html>', contentType: 'text/html' })
  );

test.describe('Notebook core transport fixture replay in a browser', () => {
  for (const notebookPath of ['/ws', '/ws?session=notebook']) {
    test(`replays only the exact notebook WebSocket pathname at ${notebookPath}`, async ({ page }) => {
      const adapter = createPlaywrightFixtureAdapter({
        metadata: fixtureMetadata(),
        records: [
          {
            kind: 'websocket',
            sequence: 1,
            websocket: { direction: 'send', payloadText: 'GET_NOTE' }
          },
          {
            kind: 'websocket',
            sequence: 2,
            websocket: { direction: 'receive', payloadText: 'NOTEBOOK_REPLY' }
          }
        ],
        version: 1
      });
      const exchange = (path: string) =>
        page.evaluate(
          socketPath =>
            new Promise<string>((resolve, reject) => {
              const socket = new WebSocket(`ws://fixture.test${socketPath}`);
              socket.onopen = () => socket.send('GET_NOTE');
              socket.onerror = () => reject(new Error(`WebSocket failed: ${socketPath}`));
              socket.onmessage = event => {
                socket.close();
                resolve(event.data as string);
              };
            }),
          path
        );

      await test.step('Given an unrelated WebSocket handler registered before notebook replay', async () => {
        await servePage(page);
        await page.routeWebSocket('**/*', socket => {
          socket.onMessage(() => socket.send('UNRELATED_REPLY'));
        });
        await adapter.install(page);
        await page.goto('http://fixture.test/');
      });

      await test.step('When unrelated paths contain ws, then they leave the notebook fixture unconsumed', async () => {
        expect(await exchange('/chat/ws')).toBe('UNRELATED_REPLY');
        expect(() => adapter.assertComplete()).toThrow('WebSocket fixture was never connected');
        expect(await exchange('/chat?next=/ws')).toBe('UNRELATED_REPLY');
        expect(() => adapter.assertComplete()).toThrow('WebSocket fixture was never connected');
      });

      await test.step('When the exact notebook pathname connects, then it receives and completes the fixture', async () => {
        expect(await exchange(notebookPath)).toBe('NOTEBOOK_REPLY');
        adapter.assertComplete();
      });
    });
  }

  test('replays a captured REST response and WebSocket exchange to a real page', async ({ page }) => {
    await servePage(page);
    const adapter = createPlaywrightFixtureAdapter(replayFixture());
    await adapter.install(page);
    await page.goto('http://fixture.test/');

    const body = await page.evaluate(async () =>
      (await fetch('/api/notebook/note-a', { headers: { accept: 'application/json' } })).json()
    );
    expect(body).toEqual({ id: 'note-a' });

    const received = await page.evaluate(
      () =>
        new Promise<string>(resolve => {
          const socket = new WebSocket('ws://fixture.test/ws');
          socket.onopen = () => socket.send(JSON.stringify({ msgId: 'm1', op: 'GET_NOTE' }));
          socket.onmessage = event => resolve(event.data as string);
        })
    );
    expect(JSON.parse(received)).toEqual({ msgId: 'm1', noteId: 'note-a', op: 'NOTE' });

    adapter.assertComplete();
  });

  test('replays a capture taken from a real server, including a request that set no Accept', async ({ page }) => {
    // Playwright may omit Accept during capture but expose */* during replay routing.
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<html><body>capture</body></html>');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'note-a' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const traffic = async () => {
      const deleted = await (await fetch('/api/notebook/note-a', { method: 'DELETE' })).json();
      const fetched = await (
        await fetch('/api/notebook/note-b', { method: 'GET', headers: { accept: 'application/json' } })
      ).json();
      return [deleted, fetched];
    };

    try {
      const recorder = createNotebookTransportRecorder(fixtureMetadata());
      recorder.install(page);
      await page.goto(base);
      expect(await page.evaluate(traffic)).toEqual([{ id: 'note-a' }, { id: 'note-a' }]);
      await recorder.stop();
      const fixture = recorder.snapshot();
      expect(validateFixture(fixture)).toEqual([]);

      const replayPage = await page.context().newPage();
      const adapter = createPlaywrightFixtureAdapter(fixture);
      await adapter.install(replayPage);
      await replayPage.goto(base);
      expect(await replayPage.evaluate(traffic)).toEqual([{ id: 'note-a' }, { id: 'note-a' }]);

      adapter.assertComplete();
      await replayPage.close();
    } finally {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    }
  });

  for (const first of ['websocket', 'body'] as const) {
    test(`capture and replay preserve ${first}-first response completion`, async ({ page }) => {
      let socket: ServerWebSocket;
      let completeBody: (() => void) | undefined;
      const server = createServer((request, response) => {
        if (request.url === '/api/notebook/note-a') {
          response.writeHead(200, { 'content-type': 'application/json' });
          completeBody = () => response.end(JSON.stringify({ id: 'note-a' }));
          if (first === 'websocket') {
            response.flushHeaders();
            socket.send('before-body');
          } else {
            completeBody();
          }
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<html><body>capture</body></html>');
      });
      const sockets = new WebSocketServer({ server, path: '/ws' });
      sockets.on('connection', connection => {
        socket = connection;
        connection.on('message', message => {
          if (message.toString() === 'ack') {
            completeBody?.();
          } else if (message.toString() === 'body-read') {
            connection.send('after-body');
          }
        });
      });
      const traffic = async (order: 'websocket' | 'body') => {
        const observed: string[] = [];
        const connection = new WebSocket(`${location.origin.replace('http:', 'ws:')}/ws`);
        const message = new Promise<void>(resolve => {
          connection.onmessage = () => {
            observed.push('websocket');
            if (order === 'websocket') connection.send('ack');
            resolve();
          };
        });
        await new Promise<void>(resolve => {
          connection.onopen = () => resolve();
        });
        const response = fetch('/api/notebook/note-a')
          .then(value => value.json())
          .then(body => {
            observed.push(body.id);
            if (order === 'body') connection.send('body-read');
          });
        await Promise.all([response, message]);
        connection.close();
        return observed;
      };
      const recorder = createNotebookTransportRecorder(fixtureMetadata());
      try {
        await test.step('Given a real server with causally ordered HTTP and WebSocket responses', async () => {
          await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
          recorder.install(page);
          await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
        });

        const live = await test.step('When the browser captures the complete exchange', async () => {
          const observed = await page.evaluate(traffic, first);
          await recorder.stop();
          return observed;
        });

        const fixture = recorder.snapshot();
        const replayPage = await page.context().newPage();
        try {
          await test.step('Then replay preserves the same body and message processing order', async () => {
            expect(live).toEqual(first === 'websocket' ? ['websocket', 'note-a'] : ['note-a', 'websocket']);
            expect(validateFixture(fixture)).toEqual([]);
            const adapter = createPlaywrightFixtureAdapter(fixture);
            await adapter.install(replayPage);
            await replayPage.goto(page.url());
            expect(await replayPage.evaluate(traffic, first)).toEqual(live);
            adapter.assertComplete();
          });
        } finally {
          await replayPage.close();
        }
      } finally {
        for (const connection of sockets.clients) connection.terminate();
        sockets.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }

  test('leaves traffic outside the notebook API to the routes already registered', async ({ page }) => {
    await servePage(page);
    // An earlier handler is reached by fallback(), but bypassed by continue().
    let served = 0;
    await page.route('**/api/security/ticket', route => {
      served += 1;
      return route.fulfill({ body: '{"ticket":"t"}', contentType: 'application/json' });
    });

    const adapter = createPlaywrightFixtureAdapter(replayFixture());
    await adapter.install(page);
    await page.goto('http://fixture.test/');

    const status = await page.evaluate(async () => (await fetch('/api/security/ticket')).status);
    expect(status).toBe(200);
    expect(served).toBe(1);
  });
});

test.describe('Notebook core transport capture auth wiring', () => {
  test('the login helper reads the shiro.ini of the server being captured', async () => {
    // Use the capture server's shiro.ini rather than the repository configuration.
    const root = mkdtempSync(join(tmpdir(), 'capture-auth-'));
    const shiro = join(root, 'conf', 'shiro.ini');
    mkdirSync(dirname(shiro), { recursive: true });
    writeFileSync(shiro, '[users]\ncapture_user = capture_pass, admin\n');

    const previous = process.env.ZEPPELIN_E2E_SHIRO_INI;
    try {
      process.env.ZEPPELIN_E2E_SHIRO_INI = shiro;
      LoginTestUtil.resetCache();

      expect(await LoginTestUtil.isShiroEnabled()).toBe(true);
      const credentials = await LoginTestUtil.getTestCredentials();
      expect(credentials.capture_user).toEqual({
        username: 'capture_user',
        password: 'capture_pass',
        roles: ['admin']
      });
    } finally {
      if (previous === undefined) {
        delete process.env.ZEPPELIN_E2E_SHIRO_INI;
      } else {
        process.env.ZEPPELIN_E2E_SHIRO_INI = previous;
      }
      LoginTestUtil.resetCache();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

test.describe('Notebook core transport capture', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);

  test('records notebook REST and WebSocket traffic from a real Zeppelin page', { tag: '@live' }, async ({ page }) => {
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    // Use the REST call directly instead of createTestNotebook(): that helper retries the
    // create-then-navigate sequence as one unit, so a post-create navigation failure would
    // leave the newly created notebook's ID out of reach of the cleanup below.
    const { noteId } = await createNotebookViaRest(page, `${E2E_TEST_FOLDER}/CoreContractCapture_${Date.now()}`);
    try {
      await page.goto('/#/');
      await waitForZeppelinReady(page);
      const recorderPage = await page.context().newPage();
      const recorder = createNotebookTransportRecorder(fixtureMetadata());

      recorder.install(recorderPage);
      await navigateToNotebookWithFallback(recorderPage, noteId);
      await recorderPage.evaluate(async id => {
        await fetch(`/api/notebook/${id}`, { headers: { accept: 'application/json' } });
      }, noteId);
      await expect
        .poll(async () => recorder.snapshot().records.some(record => record.kind === 'websocket'), { timeout: 15000 })
        .toBe(true);
      await recorder.stop();
      const fixture = recorder.snapshot();
      await recorderPage.close();

      expect(validateFixture(fixture)).toEqual([]);
      expect(fixture.records.some(record => record.kind === 'rest')).toBe(true);
      expect(fixture.records.some(record => record.kind === 'websocket')).toBe(true);
    } finally {
      // Global API cleanup is disabled under CI=true, so always delete the note here.
      // Use the original page to keep cleanup traffic out of an unfinished capture.
      try {
        const deleted = await page.evaluate(async id => {
          const response = await fetch(`/api/notebook/${id}`, { method: 'DELETE' });
          return response.ok;
        }, noteId);
        if (!deleted) {
          console.warn(`capture note ${noteId} was not deleted; remove it manually`);
        }
      } catch (error) {
        // Preserve the capture error if cleanup also fails.
        console.warn(`capture note ${noteId} could not be deleted: ${error}`);
      }
    }
  });

  test(
    'captures the complete ZEPPELIN-6672 lifecycle contract from Zeppelin',
    { tag: '@live' },
    async ({ browser, browserName, page }) => {
      test.skip(
        Boolean(liveCaptureMode) && liveCaptureMode !== 'lifecycle',
        'Lifecycle capture runs separately from other fixture captures'
      );
      await page.goto('/#/');
      await waitForZeppelinReady(page);
      await performLoginIfRequired(page);
      const authenticated = await LoginTestUtil.isShiroEnabled();
      const credentials = authenticated
        ? Object.values(await LoginTestUtil.getTestCredentials()).filter(
            credential => credential.username && credential.password && !credential.username.startsWith('wrong')
          )
        : [];
      test.skip(
        authenticated && credentials.length < 2,
        'Authenticated lifecycle capture requires two configured users'
      );
      const createdNoteIds: string[] = [];
      try {
        const { noteId } = await createNotebookViaRest(page, `${E2E_TEST_FOLDER}/LifecycleCaptureA_${Date.now()}`);
        createdNoteIds.push(noteId);
        const { noteId: secondNoteId } = await createNotebookViaRest(
          page,
          `${E2E_TEST_FOLDER}/LifecycleCaptureB_${Date.now()}`
        );
        createdNoteIds.push(secondNoteId);
        const origin = new URL(page.url()).origin;
        const actors = [
          {
            authentication: authenticated ? ('authenticated' as const) : ('anonymous' as const),
            contextId: 'browser-context-a',
            id: 'viewer-a',
            ...(authenticated ? { principalAlias: 'capture-user-a' } : {})
          },
          {
            authentication: authenticated ? ('authenticated' as const) : ('anonymous' as const),
            contextId: 'browser-context-b',
            id: 'viewer-b',
            ...(authenticated ? { principalAlias: 'capture-user-b' } : {})
          }
        ];
        const coveredOperations = [
          'MOVE_PARAGRAPH',
          'INSERT_PARAGRAPH',
          'COPY_PARAGRAPH',
          'PARAGRAPH_REMOVE',
          'COMMIT_PARAGRAPH',
          'PARAGRAPH_ADDED',
          'PARAGRAPH_REMOVED',
          'PARAGRAPH_MOVED',
          'CHECKPOINT_NOTE',
          'LIST_REVISION_HISTORY',
          'NOTE_REVISION',
          'SET_NOTE_REVISION',
          'NOTE_REVISION_FOR_COMPARE',
          'PATCH_PARAGRAPH',
          'NOTE_UPDATED',
          'COLLABORATIVE_MODE_STATUS',
          'GET_NOTE',
          'RELOAD_NOTE',
          'GET_HOME_NOTE',
          'NEW_NOTE',
          'CLONE_NOTE',
          'NOTE',
          'LIST_NOTE_JOBS',
          'UNSUBSCRIBE_UPDATE_NOTE_JOBS'
        ];
        const recorder = createNotebookLifecycleRecorder(
          {
            captureSource: 'live-server',
            contract: 'ZEPPELIN-6672',
            coveredOperations,
            knownExclusions: [],
            owner: 'zeppelin-web-angular',
            provenance: liveCaptureProvenance(page, browserName, { notebookStorage: 'git' }),
            protocolGaps: ['COMMIT_PARAGRAPH has no wire acknowledgement'],
            scenario: 'Live structural, revision, collaboration, association, and reconnect capture'
          },
          actors
        );
        let firstCaptureContext: { activeNoteId: string; revisionId?: string } | { routeKind: 'job-manager' } = {
          activeNoteId: noteId
        };
        let secondCaptureContext: { activeNoteId: string; revisionId?: string } | { routeKind: 'job-manager' } = {
          activeNoteId: noteId
        };
        let restFullNote = false;
        const classify = (
          record: { kind: string; websocket?: { payloadText?: string } },
          allowRestAuthoritative = false
        ) => {
          if (record.kind === 'rest') {
            return { authoritativeInput: 'none' as const, operationPath: 'rest' as const };
          }
          const payload = JSON.parse(record.websocket?.payloadText ?? '{}') as { op?: string };
          if (allowRestAuthoritative && restFullNote && payload.op === 'NOTE') {
            restFullNote = false;
            return { authoritativeInput: 'full-note' as const, operationPath: 'rest' as const };
          }
          return [
            'PARAGRAPH_ADDED',
            'PARAGRAPH_REMOVED',
            'PARAGRAPH_MOVED',
            'PATCH_PARAGRAPH',
            'NOTE_UPDATED',
            'COLLABORATIVE_MODE_STATUS'
          ].includes(payload.op ?? '')
            ? { authoritativeInput: 'granular-event' as const, operationPath: 'websocket' as const }
            : payload.op === 'NOTE' || payload.op === 'NOTE_REVISION'
              ? { authoritativeInput: 'full-note' as const, operationPath: 'websocket' as const }
              : { authoritativeInput: 'reply' as const, operationPath: 'websocket' as const };
        };
        const firstContext = await browser.newContext();
        const secondContext = await browser.newContext();
        const authenticateContext = async (context: import('@playwright/test').BrowserContext, index: number) => {
          if (!authenticated) return;
          const response = await context.request.post(`${origin}/api/login`, {
            form: { password: credentials[index].password, userName: credentials[index].username }
          });
          expect(response.ok()).toBe(true);
          const ticket = (await (await context.request.get(`${origin}/api/security/ticket`)).json()) as {
            body?: { principal?: string };
          };
          expect(ticket.body?.principal).toBe(credentials[index].username);
        };
        await Promise.all([authenticateContext(firstContext, 0), authenticateContext(secondContext, 1)]);
        const firstPage = await firstContext.newPage();
        const secondPage = await secondContext.newPage();
        const firstSegment = recorder.install({
          actorId: 'viewer-a',
          classify: record => classify(record),
          connectionId: 'a-1',
          getCaptureContext: () => firstCaptureContext,
          page: firstPage
        });
        recorder.install({
          actorId: 'viewer-b',
          classify: record => classify(record, true),
          connectionId: 'b-1',
          getCaptureContext: () => secondCaptureContext,
          page: secondPage
        });

        try {
          // Use raw sockets on the same two independent browser contexts so every required
          // operation is recorded from Zeppelin itself, without inventing message identities.
          await Promise.all([openRawLifecycleSocket(firstPage, origin), openRawLifecycleSocket(secondPage, origin)]);
          await sendRawLifecycleMessage(firstPage, 'GET_NOTE', { id: noteId }, 'NOTE');
          const collaborativeStart = await firstPage.evaluate(
            () => (window as unknown as RawLifecycleWindow).lifecycleMessages.length
          );
          await sendRawLifecycleMessage(secondPage, 'GET_NOTE', { id: noteId }, 'NOTE');
          await waitForRawLifecycleMessage(firstPage, 'COLLABORATIVE_MODE_STATUS', collaborativeStart);

          const inserted = await sendRawLifecycleMessage(
            firstPage,
            'INSERT_PARAGRAPH',
            { index: 0 },
            'PARAGRAPH_ADDED'
          );
          const paragraphId = (inserted?.data?.paragraph as { id: string }).id;
          const copied = await sendRawLifecycleMessage(
            firstPage,
            'COPY_PARAGRAPH',
            { config: {}, index: 1, paragraph: 'copy', params: {}, title: '' },
            'PARAGRAPH_ADDED'
          );
          const copiedId = (copied?.data?.paragraph as { id: string }).id;
          await sendRawLifecycleMessage(firstPage, 'MOVE_PARAGRAPH', { id: paragraphId, index: 1 }, 'PARAGRAPH_MOVED');
          await sendRawLifecycleMessage(firstPage, 'PARAGRAPH_REMOVE', { id: copiedId }, 'PARAGRAPH_REMOVED');
          const commitStartedAt = Date.now();
          await sendRawLifecycleMessage(firstPage, 'COMMIT_PARAGRAPH', {
            config: {},
            id: paragraphId,
            noteId,
            paragraph: '',
            params: {},
            title: ''
          });
          await expect
            .poll(() =>
              recorder.snapshot().records.some(record => {
                return JSON.parse(record.transport.websocket?.payloadText ?? '{}').op === 'COMMIT_PARAGRAPH';
              })
            )
            .toBe(true);
          const commit = [...recorder.snapshot().records]
            .reverse()
            .find(record => JSON.parse(record.transport.websocket?.payloadText ?? '{}').op === 'COMMIT_PARAGRAPH');
          expect(commit).toBeDefined();
          recorder.fault({ kind: 'drop', sequence: commit!.sequence });
          await firstPage.waitForTimeout(750);
          recorder.transition({
            actorId: 'viewer-a',
            afterSequence: commit!.sequence,
            connectionId: 'a-1',
            elapsedMs: Date.now() - commitStartedAt,
            kind: 'timeout',
            observation: 'bounded-wait',
            reason: 'commit',
            triggerSequence: commit!.sequence
          });
          const reconciliationStart = recorder.snapshot().records.length;
          await sendRawLifecycleMessage(firstPage, 'GET_NOTE', { id: noteId }, 'NOTE');
          const reconciliationRecords = recorder.snapshot().records.slice(reconciliationStart);
          const reconciliationRequest = reconciliationRecords.find(
            record =>
              record.transport.websocket?.direction === 'send' &&
              JSON.parse(record.transport.websocket.payloadText ?? '{}').op === 'GET_NOTE'
          );
          const reconciliationConfirmation = reconciliationRecords.find(
            record =>
              record.transport.websocket?.direction === 'receive' &&
              record.authoritativeInput === 'full-note' &&
              JSON.parse(record.transport.websocket.payloadText ?? '{}').op === 'NOTE'
          );
          expect(reconciliationRequest).toBeDefined();
          expect(reconciliationConfirmation).toBeDefined();
          recorder.transition({
            actorId: 'viewer-a',
            afterSequence: reconciliationRequest!.sequence,
            confirmationSequence: reconciliationConfirmation!.sequence,
            connectionId: 'a-1',
            kind: 'reconcile',
            reason: 'commit',
            requestSequence: reconciliationRequest!.sequence,
            triggerSequence: commit!.sequence
          });
          const patchStart = await secondPage.evaluate(
            () => (window as unknown as RawLifecycleWindow).lifecycleMessages.length
          );
          await sendRawLifecycleMessage(firstPage, 'PATCH_PARAGRAPH', {
            id: paragraphId,
            noteId,
            patch: '@@ -0,0 +1,4 @@\n+live\n'
          });
          await waitForRawLifecycleMessage(secondPage, 'PATCH_PARAGRAPH', patchStart);
          await sendRawLifecycleMessage(
            firstPage,
            'NOTE_UPDATE',
            { config: {}, id: noteId, name: `${E2E_TEST_FOLDER}/LifecycleCaptureA_updated` },
            'NOTE_UPDATED'
          );

          const structuralRest = async (method: string, path: string, body?: Record<string, unknown>) => {
            const start = await secondPage.evaluate(
              () => (window as unknown as RawLifecycleWindow).lifecycleMessages.length
            );
            restFullNote = true;
            const response = await secondPage.evaluate(
              async ({ body, method, path }) => {
                const result = await fetch(path, {
                  body: body ? JSON.stringify(body) : undefined,
                  headers: body ? { 'content-type': 'application/json' } : undefined,
                  method
                });
                return { body: await result.json(), ok: result.ok };
              },
              { body, method, path }
            );
            expect(response.ok).toBe(true);
            await waitForRawLifecycleMessage(secondPage, 'NOTE', start);
            return response.body as { body?: string };
          };
          const restInserted = await structuralRest('POST', `/api/notebook/${noteId}/paragraph`, {
            config: {},
            index: 0,
            params: {},
            text: '',
            title: ''
          });
          const restParagraphId = restInserted.body!;
          await structuralRest('POST', `/api/notebook/${noteId}/paragraph/${restParagraphId}/move/0`);
          await structuralRest('DELETE', `/api/notebook/${noteId}/paragraph/${restParagraphId}`);

          // Route A to B while a late granular event from A is still possible, then load B
          // and retain another granular event after the authoritative NOTE.
          firstCaptureContext = { activeNoteId: secondNoteId };
          recorder.transition({
            actorId: 'viewer-a',
            connectionId: 'a-1',
            kind: 'route',
            to: firstCaptureContext
          });
          await sendRawLifecycleMessage(secondPage, 'INSERT_PARAGRAPH', { index: 0 }, 'PARAGRAPH_ADDED');
          await sendRawLifecycleMessage(firstPage, 'GET_NOTE', { id: secondNoteId }, 'NOTE');
          secondCaptureContext = { activeNoteId: secondNoteId };
          recorder.transition({ actorId: 'viewer-b', connectionId: 'b-1', kind: 'route', to: secondCaptureContext });
          await sendRawLifecycleMessage(secondPage, 'GET_NOTE', { id: secondNoteId }, 'NOTE');
          const routeParagraph = await sendRawLifecycleMessage(
            secondPage,
            'INSERT_PARAGRAPH',
            { index: 0 },
            'PARAGRAPH_ADDED'
          );
          const routeParagraphId = (routeParagraph?.data?.paragraph as { id: string }).id;
          await sendRawLifecycleMessage(
            secondPage,
            'MOVE_PARAGRAPH',
            { id: routeParagraphId, index: 1 },
            'PARAGRAPH_MOVED'
          );

          const revisionReply = await sendRawLifecycleMessage(
            firstPage,
            'CHECKPOINT_NOTE',
            { commitMessage: 'ZEPPELIN-6672 live checkpoint', noteId: secondNoteId },
            'LIST_REVISION_HISTORY'
          );
          await sendRawLifecycleMessage(
            firstPage,
            'LIST_REVISION_HISTORY',
            { noteId: secondNoteId },
            'LIST_REVISION_HISTORY'
          );
          const revisions = revisionReply?.data?.revisionList as Array<{ id: string }>;
          expect(revisions.length).toBeGreaterThan(0);
          const revisionId = revisions[0].id;
          firstCaptureContext = { activeNoteId: secondNoteId, revisionId };
          recorder.transition({ actorId: 'viewer-a', connectionId: 'a-1', kind: 'route', to: firstCaptureContext });
          await sendRawLifecycleMessage(
            firstPage,
            'NOTE_REVISION',
            { noteId: secondNoteId, revisionId },
            'NOTE_REVISION'
          );
          await sendRawLifecycleMessage(
            firstPage,
            'NOTE_REVISION_FOR_COMPARE',
            { noteId: secondNoteId, position: 'first', revisionId },
            'NOTE_REVISION_FOR_COMPARE'
          );
          await sendRawLifecycleMessage(
            firstPage,
            'SET_NOTE_REVISION',
            { noteId: secondNoteId, revisionId },
            'SET_NOTE_REVISION'
          );
          const revisionUpdateStart = await firstPage.evaluate(
            () => (window as unknown as RawLifecycleWindow).lifecycleMessages.length
          );
          await sendRawLifecycleMessage(
            secondPage,
            'NOTE_UPDATE',
            { config: {}, id: secondNoteId, name: `${E2E_TEST_FOLDER}/LifecycleCaptureB_updated` },
            'NOTE_UPDATED'
          );
          await waitForRawLifecycleMessage(firstPage, 'NOTE_UPDATED', revisionUpdateStart);

          secondCaptureContext = { routeKind: 'job-manager' };
          recorder.transition({ actorId: 'viewer-b', connectionId: 'b-1', kind: 'route', to: secondCaptureContext });
          await sendRawLifecycleMessage(secondPage, 'LIST_NOTE_JOBS', {});
          await sendRawLifecycleMessage(secondPage, 'UNSUBSCRIBE_UPDATE_NOTE_JOBS', {});
          secondCaptureContext = { activeNoteId: noteId };
          recorder.transition({ actorId: 'viewer-b', connectionId: 'b-1', kind: 'route', to: secondCaptureContext });
          await sendRawLifecycleMessage(secondPage, 'RELOAD_NOTE', { id: noteId }, 'NOTE');
          await sendRawLifecycleMessage(secondPage, 'GET_HOME_NOTE', {}, 'NOTE');
          const newNote = await sendRawLifecycleMessage(
            secondPage,
            'NEW_NOTE',
            { name: `${E2E_TEST_FOLDER}/LifecycleNew_${Date.now()}` },
            'NEW_NOTE'
          );
          const newNoteId = (newNote?.data?.note as { id: string }).id;
          createdNoteIds.push(newNoteId);
          secondCaptureContext = { activeNoteId: newNoteId };
          recorder.transition({ actorId: 'viewer-b', connectionId: 'b-1', kind: 'route', to: secondCaptureContext });
          await sendRawLifecycleMessage(secondPage, 'GET_NOTE', { id: newNoteId }, 'NOTE');
          const clone = await sendRawLifecycleMessage(
            secondPage,
            'CLONE_NOTE',
            { id: noteId, name: `${E2E_TEST_FOLDER}/LifecycleClone_${Date.now()}` },
            'NEW_NOTE'
          );
          const cloneNoteId = (clone?.data?.note as { id: string }).id;
          createdNoteIds.push(cloneNoteId);
          secondCaptureContext = { activeNoteId: cloneNoteId };
          recorder.transition({ actorId: 'viewer-b', connectionId: 'b-1', kind: 'route', to: secondCaptureContext });
          await sendRawLifecycleMessage(secondPage, 'GET_NOTE', { id: cloneNoteId }, 'NOTE');

          secondCaptureContext = { activeNoteId: noteId };
          recorder.transition({ actorId: 'viewer-b', connectionId: 'b-1', kind: 'route', to: secondCaptureContext });
          await sendRawLifecycleMessage(secondPage, 'GET_NOTE', { id: noteId }, 'NOTE');

          await firstPage.evaluate(() => (window as unknown as RawLifecycleWindow).lifecycleSocket.close(1000));
          await firstSegment.stop();
          await firstPage.addInitScript(() => {
            const NativeWebSocket = window.WebSocket;
            const sockets: WebSocket[] = [];
            Object.defineProperty(window, '__zeppelinCaptureSockets', { value: sockets });
            window.WebSocket = class CaptureWebSocket extends NativeWebSocket {
              constructor(url: string | URL, protocols?: string | string[]) {
                super(url, protocols);
                sockets.push(this);
              }
            };
          });
          recorder.transition({ actorId: 'viewer-a', connectionId: 'a-1', kind: 'disconnect' });
          firstCaptureContext = { activeNoteId: noteId };
          recorder.transition({ actorId: 'viewer-a', connectionId: 'a-angular-1', kind: 'reconnect' });
          const angularFirstSegment = recorder.install({
            actorId: 'viewer-a',
            classify: record => classify(record),
            connectionId: 'a-angular-1',
            getCaptureContext: () => firstCaptureContext,
            page: firstPage
          });
          let angularSocketCount = 0;
          let observedTransportSequence = 0;
          const angularSockets: import('@playwright/test').WebSocket[] = [];
          firstPage.on('websocket', socket => {
            if (new URL(socket.url()).pathname !== '/ws') return;
            angularSocketCount += 1;
            angularSockets.push(socket);
            if (angularSocketCount === 1) return;
            const recordFrame = (direction: 'receive' | 'send', payload: string | Buffer) => {
              const transport = {
                kind: 'websocket',
                sequence: ++observedTransportSequence,
                websocket: {
                  direction,
                  ...(Buffer.isBuffer(payload)
                    ? { payloadBase64: payload.toString('base64') }
                    : { payloadText: String(payload) })
                }
              };
              recorder.recordObserved({
                actorId: 'viewer-a',
                captureContext: firstCaptureContext,
                classify: record => classify(record),
                connectionId: `a-angular-${angularSocketCount}`,
                transport
              });
            };
            socket.on('framesent', event => recordFrame('send', event.payload));
            socket.on('framereceived', event => recordFrame('receive', event.payload));
          });
          await navigateToNotebookWithFallback(firstPage, noteId);
          await expect
            .poll(
              () =>
                recorder
                  .snapshot()
                  .records.filter(record => record.connectionId === 'a-angular-1')
                  .map(record => JSON.parse(record.transport.websocket?.payloadText ?? '{}').op),
              { timeout: 15000 }
            )
            .toEqual(expect.arrayContaining(['GET_NOTE', 'LIST_REVISION_HISTORY']));

          const paragraphs = firstPage.locator('zeppelin-notebook-paragraph');
          const paragraphCount = await paragraphs.count();
          const collaborationStart = await secondPage.evaluate(
            () => (window as unknown as RawLifecycleWindow).lifecycleMessages.length
          );
          // JUSTIFIED: The final add control appends after the final paragraph; earlier controls insert between paragraphs.
          const addParagraph = firstPage.locator('zeppelin-notebook-add-paragraph').last();
          await addParagraph.hover();
          await addParagraph.locator('a.inner').click();
          await expect(paragraphs).toHaveCount(paragraphCount + 1);
          await waitForRawLifecycleMessage(secondPage, 'PARAGRAPH_ADDED', collaborationStart);

          await angularFirstSegment.stop();
          recorder.transition({ actorId: 'viewer-a', connectionId: 'a-angular-1', kind: 'disconnect' });
          recorder.transition({ actorId: 'viewer-a', connectionId: 'a-angular-2', kind: 'reconnect' });
          expect(angularSockets).toHaveLength(1);
          await firstPage.evaluate(() => {
            const sockets = (window as unknown as { __zeppelinCaptureSockets: WebSocket[] }).__zeppelinCaptureSockets;
            if (sockets.length !== 1) throw new Error(`Expected one active Angular socket, received ${sockets.length}`);
            sockets[0].close(4000, 'fixture reconnect capture');
          });
          await expect
            .poll(
              () =>
                recorder
                  .snapshot()
                  .records.filter(record => record.connectionId === 'a-angular-2')
                  .map(record => JSON.parse(record.transport.websocket?.payloadText ?? '{}').op),
              { timeout: 30000 }
            )
            .toEqual(expect.arrayContaining(['GET_NOTE', 'LIST_REVISION_HISTORY']));
          await firstPage.waitForTimeout(500);
          expect(angularSockets).toHaveLength(2);
          await sendRawLifecycleMessage(secondPage, 'GET_NOTE', { id: noteId }, 'NOTE');
          await recorder.stop();

          const beforeFaults = recorder.snapshot();
          const lastSequence = beforeFaults.records.at(-1)!.sequence;
          const stateMutationOperations = new Set([
            'PARAGRAPH_ADDED',
            'PARAGRAPH_REMOVED',
            'PARAGRAPH_MOVED',
            'PATCH_PARAGRAPH'
          ]);
          const candidates = beforeFaults.records.filter(
            record =>
              record.sequence < lastSequence &&
              record.sequence !== commit!.sequence &&
              record.transport.kind === 'websocket' &&
              record.transport.websocket?.direction === 'receive' &&
              record.authoritativeInput === 'granular-event' &&
              stateMutationOperations.has(JSON.parse(record.transport.websocket.payloadText ?? '{}').op)
          );
          const duplicateCandidate = candidates.find(
            record => JSON.parse(record.transport.websocket!.payloadText ?? '{}').op === 'PATCH_PARAGRAPH'
          );
          const reconciledCandidates = candidates.filter(record =>
            beforeFaults.records.some(
              candidate =>
                candidate.sequence > record.sequence &&
                candidate.sequence <= lastSequence &&
                candidate.actorId === record.actorId &&
                'activeNoteId' in candidate.captureContext &&
                'activeNoteId' in record.captureContext &&
                candidate.captureContext.activeNoteId === record.captureContext.activeNoteId &&
                candidate.authoritativeInput === 'full-note'
            )
          );
          const tailCandidates = reconciledCandidates
            .filter(record => record.sequence !== duplicateCandidate?.sequence)
            .slice(-2);
          expect(duplicateCandidate).toBeDefined();
          expect(tailCandidates).toHaveLength(2);
          recorder.fault({ kind: 'duplicate', sequence: duplicateCandidate!.sequence });
          recorder.fault({ afterSequence: lastSequence, kind: 'delay', sequence: tailCandidates[0].sequence });
          recorder.fault({ afterSequence: lastSequence, kind: 'reorder', sequence: tailCandidates[1].sequence });
          recorder.converge(['viewer-a', 'viewer-b']);
          const fixture = recorder.snapshot();
          expect(validateLifecycleFixture(fixture)).toEqual([]);
          expect(validateLifecycleContractCoverage(fixture)).toEqual([]);
          expect(new Set(fixture.records.map(record => record.actorId))).toEqual(new Set(['viewer-a', 'viewer-b']));
          expect(fixture.records.some(record => record.connectionId === 'a-angular-2')).toBe(true);
          const outputDirectory = process.env.ZEPPELIN_E2E_FIXTURE_OUTPUT_DIR;
          if (outputDirectory) {
            mkdirSync(outputDirectory, { recursive: true });
            writeFileSync(join(outputDirectory, 'notebook-lifecycle.json'), `${JSON.stringify(fixture, null, 2)}\n`);
          }
        } finally {
          await recorder.stop().catch(() => undefined);
          await firstContext.close().catch(() => undefined);
          await secondContext.close().catch(() => undefined);
          for (const id of createdNoteIds) {
            await page
              .evaluate(async note => fetch(`/api/notebook/${note}`, { method: 'DELETE' }), id)
              .catch(() => undefined);
          }
        }
      } catch (error) {
        for (const id of createdNoteIds) {
          await page
            .evaluate(async note => fetch(`/api/notebook/${note}`, { method: 'DELETE' }), id)
            .catch(() => undefined);
        }
        throw error;
      }
    }
  );
});
