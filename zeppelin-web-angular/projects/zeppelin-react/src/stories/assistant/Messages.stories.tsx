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

import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarkdownAnswer, AiDisclaimer, AssistantReply, UserMessage } from '@/entities/assistant';

import { PanelFrame, SAMPLE_ANSWER, describeSampleParagraph, toChunks } from './storyKit';

/**
 * User messages sit on the right in a shaded block. Answers are flat and full width, so code and tables get the
 * whole panel, and are attributed by the AI mark. Copy appears on hover or focus, and always under the latest
 * answer.
 */
const meta: Meta<typeof AssistantReply> = {
  title: 'Assistant/Components/Message',
  component: AssistantReply,
  parameters: {
    layout: 'padded'
  },
  argTypes: { streaming: { control: 'boolean' } }
};
export default meta;
type Story = StoryObj<typeof AssistantReply>;

export const Turn: Story = {
  args: { streaming: false },
  render: args => (
    <PanelFrame>
      <UserMessage>What does this notebook do?</UserMessage>
      <AssistantReply {...args} copyText={SAMPLE_ANSWER}>
        <MarkdownAnswer
          content={SAMPLE_ANSWER}
          describeParagraph={describeSampleParagraph}
          onOpenParagraph={() => undefined}
        />
      </AssistantReply>
      <AiDisclaimer />
    </PanelFrame>
  )
};

const StreamingReply = () => {
  const chunks = toChunks(SAMPLE_ANSWER, 6);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= chunks.length) {
      const restart = window.setTimeout(() => setCount(0), 2400);
      return () => window.clearTimeout(restart);
    }
    const next = window.setTimeout(() => setCount(value => value + 1), 28);
    return () => window.clearTimeout(next);
  }, [count, chunks.length]);
  const done = count >= chunks.length;
  const content = chunks.slice(0, count).join('');
  return (
    <PanelFrame>
      <UserMessage>What does this notebook do?</UserMessage>
      {count > 0 ? (
        <AssistantReply streaming={!done} copyText={done ? content : undefined}>
          <MarkdownAnswer
            content={content}
            describeParagraph={describeSampleParagraph}
            onOpenParagraph={() => undefined}
          />
        </AssistantReply>
      ) : null}
    </PanelFrame>
  );
};

/** Tokens arrive and the answer re-renders as Markdown; an unfinished code fence stays code. */
export const Streaming: Story = { render: () => <StreamingReply /> };

export const LongUserMessage: Story = {
  render: () => (
    <PanelFrame>
      <UserMessage>
        {`Can you check why this fails?\n\njava.lang.IllegalArgumentException: requirement failed: Column ts must be of type TimestampType but was actually StringType.`}
      </UserMessage>
    </PanelFrame>
  )
};
