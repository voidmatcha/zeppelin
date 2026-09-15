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

import { expect, Page, WebSocketRoute } from '@playwright/test';

const IDLE_SAVE_TIMEOUT_MS = 30000;
const PROXY_TIMEOUT_MS = 15000;
const ZEPPELIN_WS_URL_PATTERN = /\/ws(\?|$)/;

interface NotebookSocketMessage {
  op?: string;
  msgId?: string;
  data?: {
    id?: string;
    noteId?: string;
    paragraph?: string;
  };
}

interface CommitParagraphMessage extends NotebookSocketMessage {
  op: 'COMMIT_PARAGRAPH';
  msgId: string;
  data: {
    id: string;
    noteId: string;
    paragraph: string;
  };
}

export class CommitParagraphSocketProbe {
  private shouldHoldFirstCommitResponse = false;
  private shouldQueueServerMessages = false;
  private heldResponseMsgId: string | null = null;
  private readonly commits: CommitParagraphMessage[] = [];
  private readonly forwardedResponseMsgIds: string[] = [];
  private readonly heldResponses = new Map<string, { socket: WebSocketRoute; message: string | Buffer }>();
  private readonly queuedResponses: Array<{ socket: WebSocketRoute; message: string | Buffer }> = [];

  handleClientMessage(server: WebSocketRoute, message: string | Buffer): void {
    const parsed = parseSocketMessage(message);
    if (isCommitParagraphMessage(parsed)) {
      this.commits.push(parsed);
      if (this.shouldHoldFirstCommitResponse && this.heldResponseMsgId === null) {
        this.heldResponseMsgId = parsed.msgId;
      }
    }
    server.send(message);
  }

  handleServerMessage(socket: WebSocketRoute, message: string | Buffer): void {
    const parsed = parseSocketMessage(message);
    if (parsed?.op === 'PARAGRAPH' && parsed.msgId) {
      if (parsed.msgId === this.heldResponseMsgId && !this.heldResponses.has(parsed.msgId)) {
        this.heldResponses.set(parsed.msgId, { socket, message });
        this.shouldQueueServerMessages = true;
        return;
      }
    }
    // Preserve server order while the delayed response is delivered and observed in isolation.
    if (this.shouldQueueServerMessages) {
      this.queuedResponses.push({ socket, message });
      return;
    }
    if (parsed?.op === 'PARAGRAPH' && parsed.msgId) {
      this.forwardedResponseMsgIds.push(parsed.msgId);
    }
    socket.send(message);
  }

  holdFirstCommitParagraphResponse(): void {
    this.shouldHoldFirstCommitResponse = true;
  }

  async waitForCommitCount(expectedCount: number): Promise<CommitParagraphMessage[]> {
    await expect
      .poll(() => this.commits.length, { timeout: IDLE_SAVE_TIMEOUT_MS })
      .toBeGreaterThanOrEqual(expectedCount);
    return this.commits.slice();
  }

  async waitForHeldResponse(msgId: string): Promise<void> {
    await expect.poll(() => this.heldResponses.has(msgId), { timeout: PROXY_TIMEOUT_MS }).toBe(true);
  }

  async waitForForwardedResponse(msgId: string): Promise<void> {
    await expect
      .poll(() => this.forwardedResponseCount(msgId), { timeout: PROXY_TIMEOUT_MS })
      .toBeGreaterThanOrEqual(1);
  }

  commitCount(): number {
    return this.commits.length;
  }

  forwardedResponseCount(msgId: string): number {
    return this.forwardedResponseMsgIds.filter(forwardedMsgId => forwardedMsgId === msgId).length;
  }

  releaseHeldResponse(msgId: string): void {
    const held = this.heldResponses.get(msgId);
    if (!held) {
      throw new Error(`No held PARAGRAPH response for msgId ${msgId}`);
    }
    this.heldResponses.delete(msgId);
    this.heldResponseMsgId = null;
    this.shouldHoldFirstCommitResponse = false;
    this.forwardedResponseMsgIds.push(msgId);
    held.socket.send(held.message);
  }

  releaseQueuedResponses(): void {
    this.shouldQueueServerMessages = false;
    for (const queued of this.queuedResponses.splice(0)) {
      this.handleServerMessage(queued.socket, queued.message);
    }
  }
}

const browserParagraphReceiptProbeRegistrations = new WeakMap<Page, Promise<void>>();

export const installBrowserParagraphReceiptProbe = async (page: Page): Promise<void> => {
  const install = () => {
    type CommitReceipt = { id: string; noteId: string; msgId: string; text: string };
    type ProbeState = {
      acknowledgedCommitMsgIds: string[];
      commits: CommitReceipt[];
      observedSockets: WeakSet<WebSocket>;
      paragraphMsgIdsObservedAfterFrame: string[];
    };
    type ProbeWindow = Window & { __zeppelinParagraphReceiptProbe?: ProbeState };
    const probeWindow = window as ProbeWindow;
    if (probeWindow.__zeppelinParagraphReceiptProbe) {
      return;
    }

    const paragraphMsgIdsObservedAfterFrame: string[] = [];
    const state: ProbeState = {
      acknowledgedCommitMsgIds: [],
      commits: [],
      observedSockets: new WeakSet<WebSocket>(),
      paragraphMsgIdsObservedAfterFrame
    };
    probeWindow.__zeppelinParagraphReceiptProbe = state;
    Object.defineProperty(window, '__zeppelinParagraphMsgIdsObservedAfterFrame', {
      configurable: true,
      get: () => paragraphMsgIdsObservedAfterFrame
    });

    const parseBrowserSocketMessage = (
      data: unknown
    ): { op?: string; msgId?: string; data?: { id?: string; noteId?: string; paragraph?: unknown } } | null => {
      if (typeof data !== 'string') {
        return null;
      }
      try {
        return JSON.parse(data) as {
          op?: string;
          msgId?: string;
          data?: { id?: string; noteId?: string; paragraph?: unknown };
        };
      } catch {
        return null;
      }
    };

    const observeSocket = (socket: WebSocket): void => {
      if (state.observedSockets.has(socket)) {
        return;
      }
      state.observedSockets.add(socket);
      socket.addEventListener('message', event => {
        const message = parseBrowserSocketMessage(event.data);
        if (message?.op !== 'PARAGRAPH' || typeof message.msgId !== 'string') {
          return;
        }
        const paragraph = message.data?.paragraph;
        const commit = state.commits.find(candidate => candidate.msgId === message.msgId);
        const acknowledgesCommit =
          commit !== undefined &&
          typeof paragraph === 'object' &&
          paragraph !== null &&
          (paragraph as { id?: unknown }).id === commit.id &&
          (paragraph as { text?: unknown }).text === commit.text;
        requestAnimationFrame(() => {
          paragraphMsgIdsObservedAfterFrame.push(message.msgId!);
          if (acknowledgesCommit) {
            state.acknowledgedCommitMsgIds.push(message.msgId!);
          }
        });
      });
    };

    const NativeWebSocket = window.WebSocket;
    const nativeSend = NativeWebSocket.prototype.send;
    NativeWebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      observeSocket(this);
      const message = parseBrowserSocketMessage(data);
      if (
        message?.op === 'COMMIT_PARAGRAPH' &&
        typeof message.msgId === 'string' &&
        typeof message.data?.id === 'string' &&
        typeof message.data.noteId === 'string' &&
        typeof message.data.paragraph === 'string'
      ) {
        state.commits.push({
          id: message.data.id,
          noteId: message.data.noteId,
          msgId: message.msgId,
          text: message.data.paragraph
        });
      }
      nativeSend.call(this, data);
    };
    class ProbedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        observeSocket(this);
      }
    }
    window.WebSocket = ProbedWebSocket;
  };
  let registration = browserParagraphReceiptProbeRegistrations.get(page);
  if (!registration) {
    registration = page.addInitScript(install);
    browserParagraphReceiptProbeRegistrations.set(page, registration);
  }
  await registration;
  await page.evaluate(install);
};

export const hasBrowserPendingParagraphCommit = async (
  page: Page,
  noteId: string,
  paragraphId: string
): Promise<boolean> =>
  page.evaluate(
    ({ expectedNoteId, expectedParagraphId }) => {
      const state = (
        window as Window & {
          __zeppelinParagraphReceiptProbe?: {
            acknowledgedCommitMsgIds: string[];
            commits: Array<{ id: string; noteId: string; msgId: string }>;
          };
        }
      ).__zeppelinParagraphReceiptProbe;
      if (!state) {
        return false;
      }
      return state.commits.some(
        commit =>
          commit.noteId === expectedNoteId &&
          commit.id === expectedParagraphId &&
          !state.acknowledgedCommitMsgIds.includes(commit.msgId)
      );
    },
    { expectedNoteId: noteId, expectedParagraphId: paragraphId }
  );

export const getBrowserCommitReceiptStatus = async (
  page: Page,
  noteId: string,
  paragraphId: string,
  text: string
): Promise<'acknowledged' | 'missing' | 'pending'> =>
  page.evaluate(
    ({ expectedNoteId, expectedParagraphId, expectedText }) => {
      const state = (
        window as Window & {
          __zeppelinParagraphReceiptProbe?: {
            acknowledgedCommitMsgIds: string[];
            commits: Array<{ id: string; noteId: string; msgId: string; text: string }>;
          };
        }
      ).__zeppelinParagraphReceiptProbe;
      if (!state) {
        return 'missing';
      }
      const commit = [...state.commits]
        .reverse()
        .find(
          candidate =>
            candidate.noteId === expectedNoteId &&
            candidate.id === expectedParagraphId &&
            candidate.text === expectedText
        );
      if (!commit) {
        return 'missing';
      }
      return state.acknowledgedCommitMsgIds.includes(commit.msgId) ? 'acknowledged' : 'pending';
    },
    { expectedNoteId: noteId, expectedParagraphId: paragraphId, expectedText: text }
  );

export const installCommitParagraphProbe = async (page: Page): Promise<CommitParagraphSocketProbe> => {
  const probe = new CommitParagraphSocketProbe();
  await page.routeWebSocket(ZEPPELIN_WS_URL_PATTERN, socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => probe.handleClientMessage(server, message));
    server.onMessage(message => probe.handleServerMessage(socket, message));
  });
  return probe;
};

const parseSocketMessage = (message: string | Buffer): NotebookSocketMessage | null => {
  try {
    return JSON.parse(message.toString()) as NotebookSocketMessage;
  } catch {
    return null;
  }
};

const isCommitParagraphMessage = (message: NotebookSocketMessage | null): message is CommitParagraphMessage => {
  return (
    message?.op === 'COMMIT_PARAGRAPH' &&
    typeof message.msgId === 'string' &&
    typeof message.data?.id === 'string' &&
    typeof message.data.noteId === 'string' &&
    typeof message.data.paragraph === 'string'
  );
};

export const waitForBrowserObservedParagraphResponseAfterFrame = async (page: Page, msgId: string): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(expectedMsgId => {
          return (
            (window as Window & { __zeppelinParagraphMsgIdsObservedAfterFrame?: string[] })
              .__zeppelinParagraphMsgIdsObservedAfterFrame ?? []
          ).includes(expectedMsgId);
        }, msgId),
      { timeout: PROXY_TIMEOUT_MS }
    )
    .toBe(true);
};
