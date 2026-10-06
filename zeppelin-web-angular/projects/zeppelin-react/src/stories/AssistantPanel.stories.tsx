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

import type { Meta, StoryObj } from '@storybook/react-vite';
import type {
  AssistantRunEvent,
  AssistantMessage,
  AssistantConversation,
  AssistantTransport
} from '@/entities/assistant';
import { SAMPLE_ANSWER, toChunks } from '@/stories/assistant/storyKit';
import { AssistantPanel } from '@/widgets/assistant-panel';

// An in-memory server with the real REST and event shapes, so the real panel runs without Zeppelin.
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

interface FakeServer {
  conversations?: AssistantConversation[];
  history?: Record<string, AssistantMessage[]>;
  failRun?: boolean;
}

const fakeTransport = ({ conversations = [], history = {}, failRun = false }: FakeServer): AssistantTransport => {
  const list = [...conversations];
  const messages: Record<string, AssistantMessage[]> = { ...history };
  let counter = 0;
  return {
    listConversations: async () => list,
    createConversation: async ({ title }) => {
      const conversation = { id: `t${++counter}`, title, canSendMessage: true };
      list.unshift(conversation);
      messages[conversation.id] = [];
      return conversation;
    },
    deleteConversation: async conversationId => {
      list.splice(
        list.findIndex(conversation => conversation.id === conversationId),
        1
      );
    },
    getMessages: async conversationId => {
      await delay(250);
      return { messages: messages[conversationId] ?? [], earlierCursor: null };
    },
    openRun: async function* (conversationId, { prompt }, signal) {
      messages[conversationId] = [
        ...(messages[conversationId] ?? []),
        { id: `u${++counter}`, role: 'user', content: prompt }
      ];
      yield { type: 'run.started' } as AssistantRunEvent;
      yield { type: 'tool_call.started', toolCallId: 'tc1', name: 'list_paragraphs' } as AssistantRunEvent;
      await delay(900, signal);
      yield { type: 'tool_call.done', toolCallId: 'tc1' } as AssistantRunEvent;
      if (failRun) {
        await delay(400, signal);
        yield { type: 'run.failed', message: 'The model did not answer in time.' } as AssistantRunEvent;
        return;
      }
      const id = `a${++counter}`;
      for (const delta of toChunks(SAMPLE_ANSWER, 8)) {
        await delay(30, signal);
        yield { type: 'message.delta', messageId: id, delta } as AssistantRunEvent;
      }
      messages[conversationId].push({ id, role: 'assistant', content: SAMPLE_ANSWER });
      yield { type: 'message.done', messageId: id, content: SAMPLE_ANSWER } as AssistantRunEvent;
      yield { type: 'run.completed' } as AssistantRunEvent;
    }
  };
};

const PARAGRAPHS = [
  { id: 'paragraph_1700000000001_1', title: 'Load data' },
  { id: 'paragraph_1700000000002_2' },
  { id: 'paragraph_1700000000003_3', title: 'Daily revenue' }
];

/**
 * The real panel, with its state, drafts and streaming, against an in-memory server that speaks the same REST
 * and event shapes as Zeppelin. Send a message to watch a run.
 */
const meta: Meta<typeof AssistantPanel> = {
  title: 'Assistant/Panel',
  component: AssistantPanel,
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [
    Story => (
      <div style={{ width: 370, height: 'calc(100vh - 32px)', borderRight: '1px solid rgba(128,128,128,.25)' }}>
        <Story />
      </div>
    )
  ],
  args: { noteId: 'note-1', draftOwner: 'alice', paragraphs: PARAGRAPHS, revealParagraph: async () => 'shown' }
};
export default meta;
type Story = StoryObj<typeof AssistantPanel>;

export const NewConversation: Story = {
  args: { ...fakeTransport({}) }
};

export const WithHistory: Story = {
  args: {
    ...fakeTransport({
      conversations: [{ id: 'h1', title: 'What does this notebook do?', canSendMessage: true }],
      history: {
        h1: [
          { id: 'm1', role: 'user', content: 'What does this notebook do?' },
          { id: 'm2', role: 'assistant', content: SAMPLE_ANSWER }
        ]
      }
    })
  }
};

export const SomeoneElses: Story = {
  name: "Someone else's conversation",
  args: {
    ...fakeTransport({
      conversations: [{ id: 'h1', title: 'Revenue questions', ownerId: 'bob', canSendMessage: false }],
      history: {
        h1: [
          { id: 'm1', role: 'user', content: 'Which region grew fastest?' },
          { id: 'm2', role: 'assistant', content: 'East grew fastest: **+18%** quarter over quarter.' }
        ]
      }
    })
  }
};

export const RunFails: Story = {
  args: { ...fakeTransport({ failRun: true }) }
};
