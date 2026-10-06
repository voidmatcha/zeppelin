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
  title: 'Assistant/Foundations',
  parameters: { layout: 'padded' }
};
export default meta;
type Story = StoryObj;

const COLOR_GROUPS: Array<{ title: string; note: string; tokens: Array<[string, string]> }> = [
  {
    title: 'Text',
    note: 'Answers use the primary text; sender, metadata and hints step down.',
    tokens: [
      ['--za-text', 'Answer and user text'],
      ['--za-text-secondary', 'Sender, metadata, descriptions'],
      ['--za-text-tertiary', 'Hints, line numbers, placeholders']
    ]
  },
  {
    title: 'Surface',
    note: 'The panel is the notebook background; fills separate code, user turns and disabled input.',
    tokens: [
      ['--za-bg', 'Panel, cards'],
      ['--za-fill', 'Code blocks, read-only notice'],
      ['--za-fill-strong', 'User message, inline code'],
      ['--za-border', 'Dividers, cards'],
      ['--za-border-strong', 'Inputs, tags']
    ]
  },
  {
    title: 'Accent and status',
    note: "Zeppelin's #3071a9, derived by antd for both themes. Status colours only mark outcomes.",
    tokens: [
      ['--za-accent', 'Primary action, focus, paragraph links'],
      ['--za-accent-bg', 'Link chips, suggestion hover'],
      ['--za-success', 'Done steps']
    ]
  }
];

const Swatch = ({ name, use }: { name: string; use: string }) => (
  <li className={styleFoundations['swatch']}>
    <span className={styleFoundations['swatch-chip']} style={{ background: `var(${name})` }} />
    <code>{name}</code>
    <span>{use}</span>
  </li>
);

export const Color: Story = {
  render: () => (
    <AssistantScope className={styleFoundations['foundations']}>
      {COLOR_GROUPS.map(group => (
        <section key={group.title}>
          <h3>{group.title}</h3>
          <p>{group.note}</p>
          <ul>
            {group.tokens.map(([name, use]) => (
              <Swatch key={name} name={name} use={use} />
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h3>AI identity</h3>
        <p>
          The iridescent wash of the sidebar mark. It marks who wrote something and moves only while an answer is being
          written; it is never decoration.
        </p>
        <div className={styleFoundations['ai-row']}>
          <AiMark /> <span>At rest</span>
          <AiMark active /> <span>Writing</span>
        </div>
      </section>
    </AssistantScope>
  )
};

export const Typography: Story = {
  render: () => (
    <AssistantScope className={styleFoundations['foundations']}>
      <section>
        <h3>Type scale</h3>
        <p>One step below the notebook&apos;s 14px body, because the panel is 370px wide.</p>
        <dl className={styleFoundations['type']}>
          <dt>13 / 1.6</dt>
          <dd style={{ fontSize: 'var(--za-font-size)' }}>Answers, user messages and the composer</dd>
          <dt>12 / 600</dt>
          <dd style={{ fontSize: 'var(--za-font-size-sm)', fontWeight: 600 }}>Sender and section labels</dd>
          <dt>12</dt>
          <dd style={{ fontSize: 'var(--za-font-size-sm)' }}>Action log, tables, code</dd>
          <dt>11</dt>
          <dd style={{ fontSize: 'var(--za-font-size-xs)' }}>Hints and the disclaimer</dd>
          <dt>Mono 12</dt>
          <dd style={{ fontFamily: 'var(--za-font-mono)', fontSize: 'var(--za-font-size-sm)' }}>
            spark.read.csv(&quot;/data/sales.csv&quot;)
          </dd>
        </dl>
      </section>
      <section>
        <h3>Spacing</h3>
        <p>A 4px grid. Turns are 16px apart; pieces inside a turn 4 to 8px.</p>
        <ul className={styleFoundations['space']}>
          {[1, 2, 3, 4, 5].map(step => (
            <li key={step}>
              <span style={{ width: `var(--za-space-${step})` }} />
              <code>--za-space-{step}</code>
            </li>
          ))}
        </ul>
      </section>
    </AssistantScope>
  )
};

const MOTION: Array<[string, string, string]> = [
  ['--za-duration-fast', '110ms', 'Hover, focus and small state changes'],
  ['--za-duration-moderate', '240ms', 'A message or step arriving; log open and close'],
  ['--za-duration-slow', '400ms', 'Empty state and disclaimer, which nobody is waiting for']
];

/** Durations only; the pieces' own stories show the motion in context. */
export const Motion: Story = {
  render: () => (
    <AssistantScope className={styleFoundations['foundations']}>
      <section>
        <h3>Motion</h3>
        <p>
          Short curves after IBM Carbon&apos;s productive motion: entrances ease out, only the run indicator loops, and
          everything becomes instant under reduced motion.
        </p>
        <table className={styleFoundations['motion']}>
          <tbody>
            {MOTION.map(([name, value, use]) => (
              <tr key={name}>
                <td>
                  <code>{name}</code>
                </td>
                <td>{value}</td>
                <td>{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AssistantScope>
  )
};
