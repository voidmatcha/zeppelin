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
import { ActionLog } from '@/entities/assistant';
import { Gallery, Specimen } from './storyKit';

/**
 * One disclosure per run with every tool call the server made, in the user's words. It is open while the run
 * works, and folds afterwards so the answer stays in front.
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

export const States: Story = {
  render: () => (
    <Gallery>
      <Specimen label="Running" note="Today: the server's read tool">
        <ActionLog running steps={[{ id: '1', label: 'Read paragraphs', status: 'running' }]} />
      </Specimen>
      <Specimen label="Done, folded" note="Click to see what the assistant read">
        <ActionLog running={false} steps={[{ id: '1', label: 'Read paragraphs', status: 'done' }]} />
      </Specimen>
    </Gallery>
  )
};
