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

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Composer,
  ConversationHeader,
  ConversationList,
  type ConversationOption,
  AssistantPanelLayout,
  EmptyState,
  ConversationStart,
  ErrorNotice,
  JumpToLatest,
  LoadEarlier,
  PanelSkeleton,
  RunStatus
} from '@/entities/assistant';

import { Gallery, PanelFrame, Specimen } from './storyKit';

const meta: Meta = {
  title: 'Assistant/Components/Panel chrome',
  parameters: { layout: 'padded' }
};
export default meta;
type Story = StoryObj;

const ComposerDemo = () => {
  const [value, setValue] = useState('');
  const [running, setRunning] = useState(false);
  return (
    <PanelFrame>
      <Composer
        value={value}
        onChange={setValue}
        running={running}
        onSend={() => {
          setValue('');
          setRunning(true);
          // Stands in for the answer arriving.
          setTimeout(() => setRunning(false), 1500);
        }}
      />
    </PanelFrame>
  );
};

/** Type and press Enter: the input is held read-only while the answer runs, then frees again. */
export const ComposerInteractive: Story = { name: 'Composer', render: () => <ComposerDemo /> };

export const ComposerStates: Story = {
  render: () => (
    <Gallery>
      <Specimen label="Running">
        <Composer value="" onChange={() => undefined} onSend={() => undefined} running />
      </Specimen>
      <Specimen label="Someone else's conversation">
        <Composer
          value=""
          onChange={() => undefined}
          onSend={() => undefined}
          running={false}
          readOnlyNotice="Started by bob. Only they can continue this conversation. Start a new conversation to ask your own question."
        />
      </Specimen>
      <Specimen label="Draft not saved">
        <Composer
          value="Half a question"
          onChange={() => undefined}
          onSend={() => undefined}
          running={false}
          status="Draft is kept here, but cannot be restored after a reload."
        />
      </Specimen>
    </Gallery>
  )
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const HeaderDemo = ({ readOnly = false }: { readOnly?: boolean }) => {
  const [active, setActive] = useState<string | null>('a');
  const [conversations, setConversations] = useState<ConversationOption[]>(() => [
    {
      id: 'a',
      title: 'Why does the revenue chart dip in May?',
      readOnly,
      owner: readOnly ? 'bob' : undefined,
      updatedAt: minutesAgo(4)
    },
    { id: 'b', title: 'Explain the sales trend', updatedAt: minutesAgo(3 * 60) },
    { id: 'c', updatedAt: minutesAgo(30 * 24 * 60) }
  ]);
  const [listOpen, setListOpen] = useState(false);
  const remove = (id: string) => {
    setConversations(current => current.filter(conversation => conversation.id !== id));
    if (id === active) setActive(null);
  };
  return (
    // The list covers the panel it sits in, so the demo gives it a panel-sized frame.
    <div style={{ width: 340, height: 360, border: '1px solid rgba(128, 128, 128, 0.25)' }}>
      <AssistantPanelLayout
        header={
          <ConversationHeader
            conversations={conversations}
            activeId={active}
            onOpenList={() => setListOpen(true)}
            listOpen={listOpen}
            onNew={() => setActive(null)}
            onDelete={remove}
          />
        }
        composer={null}
        overlay={
          listOpen ? (
            <ConversationList
              conversations={conversations}
              activeId={active}
              onSelect={id => {
                setActive(id);
                setListOpen(false);
              }}
              onNew={() => {
                setActive(null);
                setListOpen(false);
              }}
              onDelete={remove}
              onClose={() => setListOpen(false)}
            />
          ) : undefined
        }
      >
        <p>Click the title to see every conversation of the note.</p>
      </AssistantPanelLayout>
    </div>
  );
};

export const Header: Story = {
  render: () => (
    <Gallery>
      <Specimen
        label="Own conversation"
        note="The list covers the panel, with search; hover or focus a row to delete it"
      >
        <HeaderDemo />
      </Specimen>
      <Specimen label="Read-only" note="A lock on the title and in the list; no delete">
        <HeaderDemo readOnly />
      </Specimen>
    </Gallery>
  )
};

export const Empty: Story = {
  render: () => (
    <PanelFrame>
      <EmptyState
        suggestions={[
          'Summarize what this notebook does',
          'Which interpreters do the paragraphs use?',
          'Where is data loaded in this notebook?'
        ]}
        onPick={() => undefined}
      />
    </PanelFrame>
  )
};

export const Feedback: Story = {
  render: () => (
    <Gallery>
      <Specimen label="Loading" note="The panel's shape, shown only after a beat so a fast load shows nothing">
        <div style={{ width: 300, height: 320 }}>
          <PanelSkeleton label="Loading the assistant…" chrome />
        </div>
      </Specimen>
      <Specimen label="Run status" note="One indicator with a specific verb">
        <RunStatus>Reading notebook context…</RunStatus>
      </Specimen>
      <Specimen label="Error" note="What happened and a way forward; output above it is kept">
        <ErrorNotice message="The model did not answer in time." onRetry={() => undefined} />
      </Specimen>
      <Specimen label="Earlier messages" note="Loads on scroll to the top; marks the start once reached">
        <LoadEarlier loading={false} onLoad={() => undefined} />
        <LoadEarlier loading onLoad={() => undefined} />
        <ConversationStart />
      </Specimen>
      <Specimen label="New reply" note="Shown when a reply lands while the user reads further up">
        <JumpToLatest onJump={() => undefined} />
      </Specimen>
    </Gallery>
  )
};
