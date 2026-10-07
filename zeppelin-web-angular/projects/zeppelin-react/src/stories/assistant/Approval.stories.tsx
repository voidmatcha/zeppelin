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
import { ParagraphLink } from '@/entities/assistant';
import { ParagraphDiff } from './showcase/ParagraphDiff';
import { ApprovalActions, ToolApproval, type ApprovalState } from '@/features/assistant-approval';
import { Gallery, LOAD_DATA_AFTER, LOAD_DATA_BEFORE, PanelFrame, Specimen } from './storyKit';

/**
 * Planned with write tools. The server holds a tool that edits or runs a paragraph until the conversation owner
 * answers. Allow applies the change and never runs it; Skip, a timeout or a disconnect means the tool does not
 * run.
 */
const meta: Meta<typeof ToolApproval> = {
  title: 'Assistant/Components/Approval',
  component: ToolApproval,
  parameters: {
    layout: 'padded'
  },
  argTypes: {
    state: { control: 'inline-radio', options: ['pending', 'allowed', 'skipped'] },
    canDecide: { control: 'boolean' }
  }
};
export default meta;
type Story = StoryObj<typeof ToolApproval>;

const target = (
  <ParagraphLink paragraphId="p1" label={{ text: 'Load data', name: 'Load data' }} onOpen={() => undefined} />
);

export const Playground: Story = {
  args: {
    action: 'Edit paragraph',
    description: 'Parse the ts column as a timestamp when reading sales.csv.',
    reviewHint: 'Review the change in the paragraph.',
    state: 'pending',
    canDecide: true
  },
  render: args => (
    <PanelFrame>
      <ToolApproval {...args} target={target} />
    </PanelFrame>
  )
};

export const States: Story = {
  render: () => (
    <Gallery>
      {(['pending', 'allowed', 'skipped'] as ApprovalState[]).map(state => (
        <Specimen key={state} label={state[0].toUpperCase() + state.slice(1)}>
          <ToolApproval
            action="Run paragraph"
            target={target}
            description="Runs the paragraph with your permissions."
            state={state}
          />
        </Specimen>
      ))}
      <Specimen label="Someone else's run" note="Only the owner on the connection that started the run can answer">
        <ToolApproval action="Edit paragraph" target={target} state="pending" canDecide={false} />
      </Specimen>
    </Gallery>
  )
};

const DiffDemo = () => {
  const [state, setState] = useState<ApprovalState>('pending');
  return (
    <div style={{ maxWidth: 720 }}>
      <ParagraphDiff
        before={LOAD_DATA_BEFORE}
        after={LOAD_DATA_AFTER}
        state={state}
        actions={<ApprovalActions onAllow={() => setState('allowed')} onSkip={() => setState('skipped')} />}
        onRun={() => setState('pending')}
      />
    </div>
  );
};

/** The same decision, made where the code is: inside the paragraph, above its editor. Run resets the demo. */
export const InParagraphDiff: StoryObj = {
  name: 'In-paragraph diff',
  render: () => (
    <PanelFrame width={760}>
      <DiffDemo />
    </PanelFrame>
  )
};
