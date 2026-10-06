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

import styleFoundations from './Foundations.module.css';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { AssistantScope } from '@/shared/ui/assistant-theme';
import { AiMark } from '@/entities/assistant';

const meta: Meta = {
  title: 'Assistant/Introduction',
  parameters: { layout: 'padded' }
};
export default meta;

const PRINCIPLES: Array<[string, string]> = [
  [
    'Model output is untrusted',
    'Markdown without raw HTML or remote images; only paragraph ids that exist in the note become links.'
  ],
  ['Say what is happening', 'One status line with a specific verb and tool calls in one log per run.'],
  [
    'Mark AI content, never decorate with it',
    'The AI mark attributes answers and moves only while one is being written. A disclaimer appears once per conversation.'
  ],
  [
    'Look like Zeppelin',
    "Every colour comes from antd tokens seeded with Zeppelin's #3071a9 and 4px radius, so light and dark follow the notebook."
  ]
];

export const Principles: StoryObj = {
  render: () => (
    <AssistantScope className={styleFoundations['foundations']}>
      <section>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20 }}>
          <AiMark /> Assistant design system
        </h3>
        <p>
          Presentational pieces for the AI panel in the notebook sidebar, in
          <code> src/entities/assistant/ui</code>. They take data and callbacks only; the conversation state and
          transport stay in <code>widgets/assistant-panel</code>. Design decisions are recorded in the{' '}
          <a
            href="https://cwiki.apache.org/confluence/spaces/ZEPPELIN/pages/451979149/Notebook+Assistant+Frontend"
            target="_blank"
            rel="noopener noreferrer"
          >
            Assistant frontend proposal
          </a>
          .
        </p>
      </section>
      <ol className={styleFoundations['principles']}>
        {PRINCIPLES.map(([title, body]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{body}</span>
          </li>
        ))}
      </ol>
    </AssistantScope>
  )
};
