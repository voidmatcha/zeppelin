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

import { expect, Page, test, WebSocketRoute } from '@playwright/test';
import { NotebookKeyboardPage } from '../../../models/notebook-keyboard-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  navigateToNotebookWithFallback,
  PAGES,
  waitForZeppelinReady
} from '../../../utils';

const IDLE_SAVE_TIMEOUT_MS = 30000;
const PROXY_TIMEOUT_MS = 15000;
const PERSISTENCE_TIMEOUT_MS = 15000;
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

test.describe('Notebook editor save timing', () => {
  test.describe.configure({ mode: 'default' });

  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK);
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_PARAGRAPH_CODE_EDITOR);

  let notebookPage: NotebookKeyboardPage;
  let commitProbe: CommitParagraphSocketProbe;
  let testNotebook: { noteId: string; paragraphId: string };

  test.beforeEach(async ({ page }) => {
    await installBrowserParagraphReceiptProbe(page);
    commitProbe = await installCommitParagraphProbe(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    testNotebook = await createTestNotebook(page);
    await navigateToNotebookWithFallback(page, testNotebook.noteId);
    notebookPage = new NotebookKeyboardPage(page);
    await expect(notebookPage.firstParagraph).toBeVisible({ timeout: 30000 });
    await notebookPage.waitForEditorRendered(0);
  });

  test('[NB-PARITY-050] persists the latest paragraph text after typing stops', async ({ page }) => {
    const text = `%md\nsave timing ${Date.now()}`;

    await typeParagraphText(notebookPage, text);
    await expectFirstParagraphEditorToBeFocused(notebookPage);
    const [commit] = await commitProbe.waitForCommitCount(1);
    expect(commit.data.paragraph).toBe(text);

    await expect.poll(() => notebookPage.getParagraphTextByIndex(0), { timeout: PERSISTENCE_TIMEOUT_MS }).toBe(text);

    await page.reload();
    await waitForZeppelinReady(page);
    await navigateToNotebookWithFallback(page, testNotebook.noteId);
    await expect.poll(() => notebookPage.getParagraphTextByIndex(0), { timeout: PERSISTENCE_TIMEOUT_MS }).toBe(text);
  });

  test('[NB-PARITY-051] keeps an edit made while an earlier save is still pending', async ({ page }) => {
    const firstText = `%md\nfirst pending save ${Date.now()}`;
    const latestText = `${firstText}\nlatest edit wins`;

    commitProbe.holdFirstCommitParagraphResponse();
    await typeParagraphText(notebookPage, firstText);
    const [firstCommit] = await commitProbe.waitForCommitCount(1);
    expect(firstCommit.data.paragraph).toBe(firstText);
    await commitProbe.waitForHeldResponse(firstCommit.msgId);
    expect(commitProbe.forwardedResponseCount(firstCommit.msgId)).toBe(0);

    await typeParagraphText(notebookPage, latestText);
    const [, secondCommit] = await commitProbe.waitForCommitCount(2);
    expect(secondCommit.data.paragraph).toBe(latestText);
    await commitProbe.waitForForwardedResponse(secondCommit.msgId);

    commitProbe.releaseHeldResponse(firstCommit.msgId);
    await commitProbe.waitForForwardedResponse(firstCommit.msgId);
    // Synchronization only: live editor, server, and reload assertions below are the behavioral proof.
    await waitForBrowserObservedParagraphResponseAfterFrame(page, firstCommit.msgId);
    await expect
      .poll(() => notebookPage.getCodeEditorContentByIndex(0), { timeout: PERSISTENCE_TIMEOUT_MS })
      .toBe(latestText);
    await expect
      .poll(() => notebookPage.getParagraphTextByIndex(0), { timeout: PERSISTENCE_TIMEOUT_MS })
      .toBe(latestText);
    expect(await notebookPage.getParagraphTextByIndex(0)).not.toBe(firstText);
    await page.reload();
    await waitForZeppelinReady(page);
    await navigateToNotebookWithFallback(page, testNotebook.noteId);
    await expect
      .poll(() => notebookPage.getParagraphTextByIndex(0), { timeout: PERSISTENCE_TIMEOUT_MS })
      .toBe(latestText);
  });
});

class CommitParagraphSocketProbe {
  private shouldHoldFirstCommitResponse = false;
  private heldResponseMsgId: string | null = null;
  private readonly commits: CommitParagraphMessage[] = [];
  private readonly forwardedResponseMsgIds: string[] = [];
  private readonly heldResponses = new Map<string, { socket: WebSocketRoute; message: string | Buffer }>();

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
        return;
      }
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

  forwardedResponseCount(msgId: string): number {
    return this.forwardedResponseMsgIds.filter(forwardedMsgId => forwardedMsgId === msgId).length;
  }

  releaseHeldResponse(msgId: string): void {
    const held = this.heldResponses.get(msgId);
    if (!held) {
      throw new Error(`No held PARAGRAPH response for msgId ${msgId}`);
    }
    this.heldResponses.delete(msgId);
    this.forwardedResponseMsgIds.push(msgId);
    held.socket.send(held.message);
  }
}

const installBrowserParagraphReceiptProbe = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const receivedParagraphMsgIds: string[] = [];
    const paragraphMsgIdsObservedAfterFrame: string[] = [];
    Object.defineProperty(window, '__zeppelinReceivedParagraphMsgIds', {
      configurable: true,
      get: () => receivedParagraphMsgIds
    });
    Object.defineProperty(window, '__zeppelinParagraphMsgIdsObservedAfterFrame', {
      configurable: true,
      get: () => paragraphMsgIdsObservedAfterFrame
    });

    const parseBrowserSocketMessage = (data: unknown): { op?: string; msgId?: string } | null => {
      if (typeof data !== 'string') {
        return null;
      }
      try {
        return JSON.parse(data) as { op?: string; msgId?: string };
      } catch {
        return null;
      }
    };

    const NativeWebSocket = window.WebSocket;
    class ProbedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          const message = parseBrowserSocketMessage(event.data);
          if (message?.op !== 'PARAGRAPH' || typeof message.msgId !== 'string') {
            return;
          }
          const msgId = message.msgId;
          receivedParagraphMsgIds.push(msgId);
          requestAnimationFrame(() => {
            paragraphMsgIdsObservedAfterFrame.push(msgId);
          });
        });
      }
    }
    window.WebSocket = ProbedWebSocket;
  });
};

const installCommitParagraphProbe = async (page: Page): Promise<CommitParagraphSocketProbe> => {
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

const typeParagraphText = async (notebookPage: NotebookKeyboardPage, text: string): Promise<void> => {
  await notebookPage.tryFocusCodeEditor();
  await notebookPage.pressSelectAll();
  await notebookPage.page.keyboard.type(text);
};

const expectFirstParagraphEditorToBeFocused = async (notebookPage: NotebookKeyboardPage): Promise<void> => {
  await expect(notebookPage.firstParagraph.locator('.monaco-editor textarea')).toBeFocused({
    timeout: PROXY_TIMEOUT_MS
  });
};

const waitForBrowserObservedParagraphResponseAfterFrame = async (page: Page, msgId: string): Promise<void> => {
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
