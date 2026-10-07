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
import { ActionLog, ParagraphLink } from '@/entities/assistant';

import { ToolApproval } from '@/features/assistant-approval';
import { Gallery, Specimen } from './storyKit';

/**
 * One disclosure per run with every tool call the server made, in the user's words. It is open while the run
 * works or needs approval, and folds afterwards so the answer stays in front.
 */
const meta: Meta<typeof ActionLog> = {
  title: 'Assistant/Components/Action log',
  component: ActionLog,
  parameters: {
    layout: 'padded'
  }
};
export default meta;
type Story = StoryObj<typeof ActionLog>;

const link = (text: string) => (
  <ParagraphLink paragraphId={text} label={{ text, name: text }} onOpen={() => undefined} />
);

export const States: Story = {
  render: () => (
    <Gallery>
      <Specimen label="Running" note="Today: the server's read tool">
        <ActionLog running steps={[{ id: '1', label: 'Read paragraphs', status: 'running' }]} />
      </Specimen>
      <Specimen label="Done, folded" note="Click to see what the assistant read">
        <ActionLog running={false} steps={[{ id: '1', label: 'Read paragraphs', status: 'done' }]} />
      </Specimen>
      <Specimen label="Waiting for approval" note="Planned: write tools hold until the user answers">
        <ActionLog
          running
          steps={[
            { id: '1', label: 'Read paragraph', status: 'done' },
            { id: '2', label: 'Edit paragraph', status: 'awaiting' }
          ]}
        >
          <ToolApproval
            action="Edit paragraph"
            target={link('Load data')}
            description="Parse the ts column as a timestamp when reading sales.csv."
            reviewHint="Review the change in the paragraph."
            state="pending"
          />
        </ActionLog>
      </Specimen>
      <Specimen label="Skipped" note="The user said no; the model is told and carries on">
        <ActionLog
          running={false}
          steps={[
            { id: '1', label: 'Edit paragraph', status: 'skipped' },
            { id: '2', label: 'Read paragraphs', status: 'done' }
          ]}
        />
      </Specimen>
    </Gallery>
  )
};
