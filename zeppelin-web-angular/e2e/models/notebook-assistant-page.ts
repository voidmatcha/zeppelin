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

import { Locator, Page, Route } from '@playwright/test';
import { BasePage } from './base-page';

const ZEPPELIN_WS_URL_PATTERN = /\/ws(\?|$)/;
const CONVERSATIONS_URL_PATTERN = /\/api\/notes\/[^/]+\/conversations(\/|\?|$)/;

export interface AssistantSocketEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface Conversation {
  id: string;
  title: string;
  noteId: string;
  updatedAt: string;
}

/**
 * Stands in for the assistant backend: the conversation REST API, and ASSISTANT_SEND_MESSAGE answered with scripted
 * ASSISTANT_EVENT frames. Every other notebook op reaches the real server.
 */
export class FakeAssistantBackend {
  readonly conversations: Conversation[] = [];
  readonly sentMessages: Array<{ noteId: string; conversationId: string; content: string }> = [];
  readonly deletedIds: string[] = [];
  private nextId = 1;
  /** The ASSISTANT_EVENT frames that answer a sent message. */
  reply: (content: string) => AssistantSocketEvent[] = () => [];

  async install(page: Page): Promise<void> {
    await page.route(CONVERSATIONS_URL_PATTERN, route => this.handleRest(route));
    await page.routeWebSocket(ZEPPELIN_WS_URL_PATTERN, socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => {
        const parsed = parse(message);
        if (parsed?.op !== 'ASSISTANT_SEND_MESSAGE') {
          server.send(message);
          return;
        }
        const data = parsed.data as { noteId: string; conversationId: string; content: string };
        this.sentMessages.push(data);
        for (const event of this.reply(data.content)) {
          socket.send(
            JSON.stringify({ op: 'ASSISTANT_EVENT', data: { conversationId: data.conversationId, ...event } })
          );
        }
      });
      server.onMessage(message => socket.send(message));
    });
  }

  private async handleRest(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const [, noteId, conversationId, tail] =
      url.pathname.match(/\/notes\/([^/]+)\/conversations(?:\/([^/]+))?(?:\/(messages))?$/) ?? [];
    if (!noteId) {
      await route.fallback();
      return;
    }
    if (request.method() === 'GET' && !conversationId) {
      await ok(route, this.conversations);
    } else if (request.method() === 'POST' && !conversationId) {
      const { title } = (request.postDataJSON() ?? {}) as { title?: string };
      const conversation = {
        id: `e2e-conversation-${this.nextId++}`,
        title: title ?? 'Untitled',
        noteId: decodeURIComponent(noteId),
        updatedAt: new Date().toISOString()
      };
      this.conversations.unshift(conversation);
      await ok(route, conversation);
    } else if (request.method() === 'DELETE' && conversationId) {
      this.deletedIds.push(conversationId);
      const index = this.conversations.findIndex(conversation => conversation.id === conversationId);
      if (index >= 0) this.conversations.splice(index, 1);
      await ok(route, null);
    } else if (request.method() === 'GET' && tail === 'messages') {
      await ok(route, { messages: [], nextCursor: null });
    } else {
      await route.fallback();
    }
  }
}

const ok = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK', body }) });

const parse = (message: string | Buffer): { op?: string; data?: unknown } | null => {
  try {
    return JSON.parse(message.toString()) as { op?: string; data?: unknown };
  } catch {
    return null;
  }
};

export class NotebookAssistantPage extends BasePage {
  readonly toggleButton: Locator;
  readonly panel: Locator;
  readonly closeButton: Locator;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly threadSelect: Locator;
  readonly messages: Locator;

  constructor(page: Page) {
    super(page);
    this.toggleButton = page.getByRole('button', { name: 'Toggle AI Assistant', exact: true });
    this.panel = page.getByRole('complementary', { name: 'AI Assistant workspace', exact: true });
    this.closeButton = this.panel.getByRole('button', { name: 'Close AI Assistant', exact: true });
    this.messageInput = this.panel.getByRole('textbox', { name: 'Message', exact: true });
    this.sendButton = this.panel.getByRole('button', { name: 'Send', exact: true });
    this.threadSelect = this.panel.getByRole('combobox', { name: 'Thread', exact: true });
    this.messages = this.panel.getByLabel('Messages', { exact: true });
  }

  deleteButton(title: string): Locator {
    return this.panel.getByRole('button', { name: `Delete ${title}`, exact: true });
  }

  async open(): Promise<void> {
    await this.toggleButton.click();
    await this.messageInput.waitFor({ state: 'visible' });
  }

  async ask(question: string): Promise<void> {
    await this.messageInput.fill(question);
    await this.sendButton.click();
  }
}
