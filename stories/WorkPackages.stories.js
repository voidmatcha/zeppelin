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
import './work-packages.css';

const source = path => `https://github.com/voidmatcha/zeppelin/${path.endsWith('/') ? 'tree' : 'blob'}/voidmatcha/assistant-storybook-share/${path}`;
const story = (label, id) => ({ label, href: `./?path=/story/${id}` });
const example = (label, path) => ({ label, href: `./examples/${path}` });

const packages = [
  {
    title: '01 · Answers and run states',
    prerequisite: 'Start from a UI base containing #5558, #5561, and #5562. No server is needed.',
    paths: 'src/entities/assistant/ui/ and src/shared/ui/assistant-icon/ in zeppelin-react',
    result: 'Render an answer, its message context, and the visible run state from supplied data.',
    boundary: 'No conversation fetching, message sending, or panel state ownership.',
    stories: [
      story('Markdown: GFM table', 'assistant-markdownanswer--gfm-table'),
      story('Markdown: partial code fence', 'assistant-markdownanswer--partial-fence'),
      story('Markdown: paragraph reference', 'assistant-markdownanswer--paragraph-reference'),
      story('Message: streaming reply', 'assistant-message--streaming-reply'),
      story('Status: loading', 'assistant-status--loading'),
      story('Status: error', 'assistant-status--error'),
      story('Action log: running', 'assistant-actionlog--running'),
      story('AI icon: conversation', 'assistant-assistanticon--conversation')
    ],
    files: [
      example('Rendered HTML: GFM table', 'assistant-markdownanswer--gfm-table-light.html'),
      example('Rendered HTML: streaming reply', 'assistant-message--streaming-reply-light.html')
    ],
    done: 'React component stories cover complete, streaming, loading, error, and partial Markdown states in both themes. Paragraph links call a supplied callback.'
  },
  {
    title: '02 · Composer and conversation navigation',
    prerequisite: 'Use the same UI base as package 01; use its Assistant icon after that package merges.',
    paths: 'src/entities/assistant/ui/ in zeppelin-react (Composer, ConversationHeader, ConversationList, EmptyState)',
    result: 'Implement the input and navigation components with callbacks for their user actions.',
    boundary: 'Do not call REST/WebSocket APIs or own the panel-wide conversation state.',
    stories: [
      story('Composer: draft', 'assistant-composer--draft'),
      story('Composer: send', 'assistant-composer--send'),
      story('Composer: running', 'assistant-composer--running'),
      story('Composer: read-only', 'assistant-composer--read-only'),
      story('Conversation list: search', 'assistant-conversationlist--search'),
      story('Conversation list: select and delete', 'assistant-conversationlist--select-and-delete'),
      story('Header: current conversation', 'assistant-conversationheader--current'),
      story('Empty state: suggestions', 'assistant-emptystate--suggestions')
    ],
    files: [
      example('Rendered HTML: composer draft', 'assistant-composer--draft-light.html'),
      example('Rendered HTML: conversation list', 'assistant-conversationlist--conversations-light.html')
    ],
    done: 'Controlled value and callbacks, Enter/Shift+Enter/IME, busy and read-only states, search, selection, and delete actions are covered.'
  },
  {
    title: '03 · Panel composition and conversation state',
    prerequisite: 'Packages 01 and 02, the #5561 AssistantTransport type, and a deterministic fixture implementation.',
    paths: 'src/widgets/assistant-panel/ in zeppelin-react',
    result: 'Assemble packages 01 and 02 using injected AssistantTransport operations.',
    boundary: 'Own layout, drafts, sending, streaming, history, and recovery with a fixture. Package 04 constructs the real transport and owns its lifecycle.',
    stories: [
      story('Panel layout: conversation', 'assistant-panellayout--conversation'),
      story('Panel: history', 'assistant-panel--history'),
      story('Panel: streaming', 'assistant-panel--streaming'),
      story('Panel: request error', 'assistant-panel--request-error'),
      story('Interactive conversation fixture', 'assistant-interactive-demo--conversation')
    ],
    files: [
      example('Rendered HTML: panel history', 'assistant-panel--history-light.html'),
      example('Interactive HTML demo', 'conversation-light.html')
    ],
    referenceLimit: 'The HTML demo previews selected interactions. It does not persist separate transcripts or drafts when switching conversations. Use the written criteria and a typed transport fixture for those behaviors.',
    done: 'Switching, draft retention, send, streaming, earlier history, read-only, and error recovery work with fixture responses. Send stays disabled during a run; Stop needs a future server protocol.'
  },
  {
    title: '04 · Notebook host integration',
    prerequisite: 'Package 03 plus a verified #5563 transport and the server running-state response.',
    paths: 'src/pages/assistant-workspace/ in zeppelin-react and notebook/assistant/ in zeppelin-web-angular',
    result: 'Mount the completed panel in the notebook and connect host callbacks and visibility.',
    boundary: 'Construct and scope real transport from notebook identity, WebSocket, and authentication callbacks. Clean it up on note/account change and unmount. Do not rewrite panel internals.',
    stories: [
      story('Full flow: ask in the panel', 'assistant-looping-flows--ask-in-the-panel'),
      story('Full flow: earlier history', 'assistant-looping-flows--earlier-history'),
      story('Full flow: list and search', 'assistant-looping-flows--list-and-search'),
      story('Full flow: read-only', 'assistant-looping-flows--read-only')
    ],
    files: [
      example('Looping HTML: ask', 'loop-ask-light.html'),
      example('Looping HTML: read-only', 'loop-readonly-light.html')
    ],
    done: 'Notebook open/close, navigation, theme, authentication handoff, cleanup, and responsive placement work without changing the panel contract.'
  },
  {
    title: '05 · End-to-end verification',
    prerequisite: 'Package 04 mounted in a test notebook with deterministic REST/WebSocket fixtures.',
    paths: 'e2e/tests/notebook/assistant/ and supporting page/fixture files in zeppelin-web-angular',
    result: 'Verify the integrated notebook in the browser with fixture server responses.',
    boundary: 'Use the four current looping flows as scenarios; visual playback does not prove the integration. A separate mentor-run smoke check must use a real enabled server.',
    stories: [
      story('Ask and stream', 'assistant-looping-flows--ask-in-the-panel'),
      story('Load earlier history', 'assistant-looping-flows--earlier-history'),
      story('List, search, and select', 'assistant-looping-flows--list-and-search'),
      story('Read-only conversation', 'assistant-looping-flows--read-only')
    ],
    files: [example('Looping HTML: list', 'loop-list-light.html')],
    done: 'Browser tests assert request/event fixtures, UI transitions, and final states, including rejection or disconnect recovery and note-switch cleanup.'
  }
];

function link(item) {
  const anchor = document.createElement('a');
  anchor.href = item.href;
  anchor.textContent = item.label;
  anchor.target = item.href.startsWith('./?') ? '_top' : '_blank';
  if (anchor.target === '_blank') anchor.rel = 'noopener noreferrer';
  return anchor;
}

function section(title, items) {
  const wrapper = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const list = document.createElement('ul');
  for (const item of items) {
    const entry = document.createElement('li');
    entry.append(link(item));
    list.append(entry);
  }
  wrapper.append(heading, list);
  return wrapper;
}

function paragraph(label, value) {
  const element = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label} `;
  element.append(strong, value);
  return element;
}

function renderPackage(item) {
  const root = document.createElement('main');
  root.className = 'work-package';
  const heading = document.createElement('h1');
  heading.textContent = item.title;
  root.append(heading, paragraph('Start from:', item.prerequisite), paragraph('Likely code area:', item.paths), paragraph('Goal:', item.result), paragraph('Boundary:', item.boundary));
  root.append(section('Start with these stories', item.stories), section('HTML examples', item.files));
  root.append(section('Shared source', [
    { label: 'Rendered screen HTML', href: source('public/screens/') },
    { label: 'Shared reference CSS', href: source('public/reference.css') },
    { label: 'Static and looping examples', href: source('public/examples/') }
  ]));
  if (item.referenceLimit) root.append(paragraph('Fixture limit:', item.referenceLimit));
  root.append(paragraph('Done when:', item.done));
  return root;
}

function renderOverview() {
  const root = document.createElement('main');
  root.className = 'work-package';
  const heading = document.createElement('h1');
  heading.textContent = 'Assistant implementation guide';
  root.append(heading);
  root.append(paragraph('Start here:', 'Choose a work package below, then follow its story states and HTML/CSS links. Use the theme toolbar to inspect both themes.'));
  root.append(paragraph('Reference vs. implementation:', 'These pages are HTML/CSS snapshots and local fixture demos. Implement the Zeppelin UI in React and vanilla-extract; add the corresponding React stories with each feature PR.'));
  root.append(paragraph('Mentor setup:', 'Before assignment, pin a UI starter branch containing #5558, #5561, and #5562, with no finished UI. Provide the branch SHA, editable paths, install/test commands, and a typed fixture transport in each issue. The real-server smoke setup belongs to the mentor.'));
  root.append(section('Common reference', [
    story('Theme and layout foundation', 'assistant-foundations--theme'),
    { label: 'Shared reference CSS', href: source('public/reference.css') }
  ]));
  root.append(section('Current work, in dependency order', packages.map((item, index) => story(item.title, `assistant-00-work-packages--package-${index + 1}`))));
  root.append(section('Future work, outside these packages', [
    story('Planned approval demo', 'assistant-interactive-demo--planned-approval'),
    story('Planned edit and run approval', 'assistant-looping-flows--planned-approve-edit-then-run'),
    story('Planned skipped edit', 'assistant-looping-flows--planned-skip-edit')
  ]));
  root.append(paragraph('Future scope:', 'Approval needs a separate server decision protocol. The planned stories are visual proposals, not acceptance criteria for the current five packages.'));
  return root;
}

export default { title: 'Assistant/00 Work packages' };
export const Overview = { render: renderOverview };
export const Package1 = { name: '01 Answers and run states', render: () => renderPackage(packages[0]) };
export const Package2 = { name: '02 Composer and navigation', render: () => renderPackage(packages[1]) };
export const Package3 = { name: '03 Panel and conversation state', render: () => renderPackage(packages[2]) };
export const Package4 = { name: '04 Notebook host integration', render: () => renderPackage(packages[3]) };
export const Package5 = { name: '05 End-to-end verification', render: () => renderPackage(packages[4]) };
