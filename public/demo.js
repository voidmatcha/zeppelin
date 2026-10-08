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
export function conversationDemo(root, approval = false) {
  const scope = root.firstElementChild;
  const log = scope.querySelector('[role="log"]') ?? scope.querySelector('article').parentElement;
  const input = scope.querySelector('textarea');
  const send = scope.querySelector('footer button');
  const originalSend = send.innerHTML;
  const userTemplate = log.querySelector('[data-role="user"]').cloneNode(true);
  const answerTemplate = log.querySelector('[data-role="assistant"]').cloneNode(true);
  let timer;
  const stop = () => { clearInterval(timer); timer = undefined; send.innerHTML = originalSend; send.disabled = !input.value.trim(); };
  input.addEventListener('input', () => { send.disabled = !input.value.trim() && !timer; });
  function submit() {
    if (timer) { stop(); return; }
    if (!input.value.trim()) return;
    const user = userTemplate.cloneNode(true);
    user.querySelector('p, div').textContent = input.value;
    log.append(user);
    input.value = '';
    if (approval) { showProposal(); return; }
    const message = answerTemplate.cloneNode(true);
    const body = message.querySelector('p');
    body.textContent = '';
    log.append(message);
    const text = 'It reads the orders dataset and groups revenue by region.';
    let offset = 0;
    send.textContent = 'Stop'; send.disabled = false;
    timer = setInterval(() => {
      if (!root.isConnected) { stop(); return; }
      offset += 3; body.textContent = text.slice(0, offset);
      log.scrollTop = log.scrollHeight;
      if (offset >= text.length) stop();
    }, 80);
  }
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  scope.querySelector('[aria-label="New conversation"]').addEventListener('click', () => { stop(); log.innerHTML = ''; scope.querySelector('button[title]').title = 'New conversation'; input.disabled = false; });
  scope.querySelector('[title="Delete conversation"]').addEventListener('click', () => {
    if (scope.querySelector('.demo-confirm')) return;
    const confirmation = document.createElement('div'); confirmation.className = 'demo-confirm demo-card';
    confirmation.innerHTML = '<strong>Delete this conversation?</strong><p>This cannot be undone.</p><button>Cancel</button><button>Delete</button>';
    confirmation.querySelectorAll('button')[0].onclick = () => confirmation.remove();
    confirmation.querySelectorAll('button')[1].onclick = () => { stop(); log.innerHTML = ''; confirmation.remove(); };
    scope.querySelector('header').append(confirmation);
  });
  const titleButton = scope.querySelector('header > button');
  titleButton.addEventListener('click', () => {
    const existing = scope.querySelector('.demo-list'); if (existing) { existing.remove(); return; }
    const overlay = document.createElement('div'); overlay.className = 'demo-list demo-card';
    overlay.innerHTML = '<input aria-label="Search conversations" placeholder="Search conversations"><div><button>Notebook summary</button><button>SQL query help</button><button>Another user’s conversation (read-only)</button></div>';
    overlay.querySelector('input').oninput = e => overlay.querySelectorAll('button').forEach(b => b.hidden = !b.textContent.toLowerCase().includes(e.target.value.toLowerCase()));
    overlay.querySelectorAll('button').forEach(b => b.onclick = () => { titleButton.title = b.textContent; titleButton.querySelector('span:not([class="hcfrxgp"])').textContent = b.textContent; input.disabled = b.textContent.includes('read-only'); send.disabled = input.disabled || !input.value.trim(); overlay.remove(); });
    scope.querySelector('header').append(overlay);
  });
  const earlier = document.createElement('button'); earlier.textContent = 'Load earlier messages'; earlier.className = 'demo-earlier';
  earlier.onclick = () => { log.prepend(userTemplate.cloneNode(true), answerTemplate.cloneNode(true)); earlier.textContent = 'Beginning of conversation'; earlier.disabled = true; };
  log.prepend(earlier);
  root.addEventListener('click', e => {
    const button = e.target.closest('[aria-label="Copy answer"]');
    if (button) navigator.clipboard?.writeText(button.closest('article').innerText).catch(() => {});
  });
  function showProposal() {
    const card = document.createElement('section'); card.className = 'demo-card';
    card.innerHTML = '<strong>Proposed edit · Paragraph 2</strong><pre><del>SELECT * FROM orders;</del>\n<ins>SELECT region, SUM(revenue) FROM orders GROUP BY region;</ins></pre><p>Review the change before applying it.</p><button>Skip edit</button><button>Allow edit</button>';
    log.append(card);
    const [skip, allow] = card.querySelectorAll('button');
    skip.onclick = () => { card.innerHTML = '<strong>Edit skipped</strong><p>The notebook was not changed or executed.</p>'; };
    allow.onclick = () => {
      card.innerHTML = '<strong>Edit applied</strong><p>Execution requires a separate approval.</p><button>Skip execution</button><button>Allow execution</button>';
      const [skipRun, run] = card.querySelectorAll('button');
      skipRun.onclick = () => card.innerHTML = '<strong>Execution skipped</strong><p>The edit remains applied. Nothing was executed.</p>';
      run.onclick = () => { card.innerHTML = '<strong>Running paragraph…</strong>'; setTimeout(() => { if (root.isConnected) card.innerHTML = '<strong>Execution completed</strong><table><tr><th>Region</th><th>Revenue</th></tr><tr><td>APAC</td><td>120,000</td></tr></table>'; }, 700); };
    };
  }
  if (approval) {
    const note = document.createElement('p'); note.className = 'demo-note'; note.textContent = 'Planned interaction reference · fixture only. Editing and execution require separate decisions. No notebook or server is changed.'; root.prepend(note);
    showProposal();
  }
  return root;
}
