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
import { LOAD_DATA_AFTER, LOAD_DATA_BEFORE } from '../storyKit';
import { Showcase } from './Showcase';
import type { ScenarioApi, ShowcaseState } from './useScenario';

/**
 * The planned approval flow, scripted on the real pieces with the panel on the left as in the notebook sidebar.
 * It waits for you to click Allow or Skip. Today's flow runs on the real panel under Assistant/Panel.
 */
const meta: Meta<typeof Showcase> = {
  title: 'Assistant/Showcase',
  component: Showcase,
  parameters: {
    layout: 'padded'
  }
};
export default meta;
type Story = StoryObj<typeof Showcase>;

const LOAD = 'paragraph_1700000000001_1';
const CLEAN = 'paragraph_1700000000002_2';
const DAILY = 'paragraph_1700000000003_3';

const DAILY_CODE = `%spark
spark.sql("""
  SELECT to_date(ts) AS day, sum(amount) AS revenue
  FROM clean GROUP BY 1 ORDER BY 1
""").show()`;

const footer = (seconds: number, time: string) =>
  `Took ${seconds} seconds. Last updated by alice at October 06 2026, ${time} AM.`;

// DataFrame.show() output, the way the Spark interpreter prints it.
const table = (rows: string[][]) => {
  const all = [['day', 'revenue'], ...rows];
  const widths = [0, 1].map(column => Math.max(...all.map(row => row[column].length)));
  const line = `+${widths.map(width => '-'.repeat(width)).join('+')}+`;
  const format = (row: string[]) => `|${row.map((cell, column) => cell.padStart(widths[column])).join('|')}|`;
  return [line, format(all[0]), line, ...rows.map(format), line].join('\n');
};

const notebook = (): ShowcaseState => ({
  draft: '',
  messages: [],
  steps: [],
  approval: null,
  status: null,
  running: false,
  beat: 0,
  waiting: false,
  paragraphs: [
    { id: LOAD, title: 'Load data', code: LOAD_DATA_BEFORE, status: 'FINISHED', footer: footer(3, '9:11:40') },
    {
      id: CLEAN,
      title: 'Clean regions',
      code: '%spark\nval clean = sales.na.drop(Seq("region"))\nclean.createOrReplaceTempView("clean")',
      status: 'FINISHED',
      footer: footer(2, '9:11:52')
    },
    {
      id: DAILY,
      title: 'Daily revenue',
      code: DAILY_CODE,
      status: 'FINISHED',
      output: table([
        ['null', '1204330'],
        ['2026-05-02', '41020']
      ]),
      footer: footer(4, '9:12:08')
    }
  ]
});

const ask = async (api: ScenarioApi, question: string) => {
  await api.wait(500);
  await api.type(question);
  await api.wait(250);
  api.set(state => ({
    ...state,
    draft: '',
    running: true,
    status: 'Thinking…',
    messages: [{ id: 'u1', role: 'user', content: question }]
  }));
};

const readStep = async (api: ScenarioApi, id: string, label: string) => {
  api.set(state => ({
    ...state,
    status: 'Reading notebook context…',
    steps: [...state.steps, { id, label, status: 'running' }]
  }));
  await api.wait(900);
  api.set(state => ({
    ...state,
    steps: state.steps.map(step => (step.id === id ? { ...step, status: 'done' } : step))
  }));
};

const highlight = (api: ScenarioApi, paragraphId: string | null) =>
  api.set(state => ({
    ...state,
    paragraphs: state.paragraphs.map(paragraph => ({ ...paragraph, highlight: paragraph.id === paragraphId }))
  }));

const writeToolsScript = async (api: ScenarioApi) => {
  api.beat(0);
  await ask(api, 'Fix the null day in Daily revenue');
  api.beat(1);
  await readStep(api, 'r1', 'Read paragraphs');
  await readStep(api, 'r2', 'Read output');
  api.beat(2);
  highlight(api, LOAD);
  api.set(state => ({
    ...state,
    status: null,
    steps: [...state.steps, { id: 'e1', label: 'Edit paragraph', status: 'awaiting' }],
    approval: {
      action: 'Edit paragraph',
      paragraphId: LOAD,
      description: 'Read ts as a timestamp so to_date() no longer returns null.',
      state: 'pending'
    },
    paragraphs: state.paragraphs.map(paragraph =>
      paragraph.id === LOAD
        ? { ...paragraph, diff: { before: LOAD_DATA_BEFORE, after: LOAD_DATA_AFTER, state: 'pending' } }
        : paragraph
    )
  }));
  const edit = await api.decide();
  api.beat(3);
  if (edit === 'skip') {
    api.set(state => ({
      ...state,
      steps: state.steps.map(step => (step.id === 'e1' ? { ...step, status: 'skipped' } : step)),
      approval: state.approval && { ...state.approval, state: 'skipped' },
      paragraphs: state.paragraphs.map(paragraph =>
        paragraph.id === LOAD && paragraph.diff
          ? { ...paragraph, diff: { ...paragraph.diff, state: 'skipped' } }
          : paragraph
      ),
      status: 'Writing response…'
    }));
    await api.wait(600);
    highlight(api, null);
    await api.stream(
      'a1',
      `Okay, I left ${LOAD} unchanged. You can add the two read options yourself when you are ready.`
    );
    api.set(state => ({ ...state, running: false, status: null }));
    return;
  }
  api.set(state => ({
    ...state,
    steps: state.steps.map(step => (step.id === 'e1' ? { ...step, status: 'done' } : step)),
    approval: state.approval && { ...state.approval, state: 'allowed' },
    paragraphs: state.paragraphs.map(paragraph =>
      paragraph.id === LOAD && paragraph.diff
        ? { ...paragraph, code: LOAD_DATA_AFTER, status: 'READY', diff: { ...paragraph.diff, state: 'allowed' } }
        : paragraph
    )
  }));
  await api.wait(900);
  api.beat(4);
  api.set(state => ({
    ...state,
    steps: [...state.steps, { id: 'x1', label: 'Run paragraph', status: 'awaiting' }],
    approval: {
      action: 'Run paragraph',
      paragraphId: LOAD,
      description: 'Runs Load data, then Daily revenue reads the new schema.',
      state: 'pending'
    }
  }));
  const run = await api.decide();
  if (run === 'skip') {
    api.set(state => ({
      ...state,
      steps: state.steps.map(step => (step.id === 'x1' ? { ...step, status: 'skipped' } : step)),
      approval: state.approval && { ...state.approval, state: 'skipped' }
    }));
    await api.stream('a1', `I updated ${LOAD}. Run it when you are ready, then rerun ${DAILY}.`);
    api.set(state => ({ ...state, running: false, status: null }));
    return;
  }
  api.set(state => ({
    ...state,
    steps: state.steps.map(step => (step.id === 'x1' ? { ...step, status: 'running' } : step)),
    approval: state.approval && { ...state.approval, state: 'allowed' },
    paragraphs: state.paragraphs.map(paragraph =>
      paragraph.id === LOAD ? { ...paragraph, status: 'RUNNING', diff: undefined } : paragraph
    )
  }));
  await api.wait(1500);
  api.set(state => ({
    ...state,
    steps: state.steps.map(step => (step.id === 'x1' ? { ...step, status: 'done' } : step)),
    paragraphs: state.paragraphs.map(paragraph => {
      if (paragraph.id === LOAD)
        return { ...paragraph, status: 'FINISHED', highlight: false, footer: footer(3, '9:14:27') };
      if (paragraph.id === DAILY) {
        return {
          ...paragraph,
          highlight: true,
          status: 'FINISHED',
          footer: footer(3, '9:14:31'),
          output: table([
            ['2026-05-01', '38910'],
            ['2026-05-02', '41020']
          ])
        };
      }
      return paragraph;
    }),
    status: 'Writing response…'
  }));
  api.beat(5);
  await api.stream(
    'a1',
    `Done. ${LOAD} now reads \`ts\` as a timestamp, and ${DAILY} shows **2026-05-01** instead of a null day.`
  );
  api.set(state => ({ ...state, running: false, status: null }));
  await api.wait(1600);
  highlight(api, null);
};

export const WithWriteTools: Story = {
  name: 'With write tools (planned)',
  args: {
    title: 'With write tools (planned)',
    summary:
      'Nothing changes without approval. The edit is shown as a diff inside the paragraph and in the action log; Allow applies it without running, and running asks again.',
    beats: ['Ask', 'Read', 'Propose an edit', 'Apply after Allow', 'Ask to run', 'Answer with the result'],
    initial: notebook,
    script: writeToolsScript
  }
};
