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
const baseCode = `%md
# Sales analysis
Loads sales data and charts revenue by region.`;
const salesCode = `%python
import pandas as pd
sales = pd.DataFrame({
    'region': ['East', 'West', 'North', 'South', 'East', 'West', 'North', 'South'],
    'revenue': [120, 340, 90, 210, 160, 80, 130, 260],
})
print(sales.head())`;
const groupCode = `%python
by_region = sales.groupby('region')['revenue'].sum()
print(by_region)`;
const proposedCode = `%python
by_region = sales.groupby('region')['revenue'].sum().sort_values(ascending=False)
print(by_region.head(3))`;
const rows = `  region  revenue
0   East      120
1   West      340
2  North       90
3  South      210
4   East      160`;
const grouped = `region
East     280
North    220
South    470
West     420
Name: revenue, dtype: int64`;
const topThree = `region
South    470
West     420
East     280
Name: revenue, dtype: int64`;
const step = ms => new Promise(resolve => setTimeout(resolve, ms));
async function typeInto(element, value, delay = 24) {
  element.value = '';
  for (const char of value) {
    element.value += char;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await step(delay);
  }
}
function transition(element) {
  element.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 350, easing: 'ease-out' });
}

function paragraph(code, output = '', id = '') {
  const el = document.createElement('section'); el.className = 'flow-paragraph'; el.dataset.paragraph = id;
  const state = document.createElement('div'); state.className = 'flow-state'; state.textContent = output ? 'FINISHED   ◉  ⚙' : 'READY   ◉  ⚙';
  const pre = document.createElement('pre'); pre.className = 'flow-code'; pre.textContent = code;
  const result = document.createElement('pre'); result.className = 'flow-output'; result.textContent = output;
  el.append(state, pre, result);
  if (output) { const caption = document.createElement('div'); caption.className = 'flow-result'; caption.textContent = 'Took 0 seconds. Last updated by anonymous.'; el.append(caption); }
  return el;
}
function appendMessage(panel, text, role) {
  const log = panel._flowLog ?? panel.querySelector('[role="log"]') ?? panel.querySelector('[data-role="assistant"]').parentElement;
  const sample = panel._flowTemplates?.[role] ?? panel.querySelector(`[data-role="${role}"]`);
  const message = sample.cloneNode(true);
  if (role === 'user') { const target = message.querySelector(':scope > div:last-child'); target.textContent = text; }
  else { const body = message.querySelector('p'); body.textContent = text; }
  log.append(message); transition(message); log.scrollTop = log.scrollHeight; return message;
}
function actionCard(panel, label, state) {
  const log = panel._flowLog ?? panel.querySelector('[role="log"]') ?? panel.querySelector('[data-role="assistant"]').parentElement;
  const card = document.createElement('div'); card.className='flow-approval';
  card.innerHTML = `<strong>${label}</strong><p>${state}</p>`;
  log.append(card); transition(card); log.scrollTop = log.scrollHeight; return card;
}
function makeShell(panel, scenario) {
  const shell=document.createElement('div'); shell.className='flow';
  shell.innerHTML='<header class="flow-top"><div class="flow-brand">Zeppelin</div><span>Notebook ▾</span><span>Job</span><span class="flow-spacer"></span><span class="flow-search">⌕ Search</span><span>● alice ▾</span></header><div class="flow-titlebar"><h1>Assistant QA</h1><span class="flow-tools">⊙ ◉ ⛶ ▦ ♧ ▣ ↻</span><span class="flow-spacer"></span><span>◉ 1</span></div><div class="flow-main"><aside class="flow-aside"><div class="flow-aside-title">☷ &nbsp; AI Assistant</div><div class="flow-panel"></div></aside><main class="flow-notebook"></main></div>';
  const mount=shell.querySelector('.flow-panel'); mount.append(panel);
  const log=panel.querySelector('[role="log"]') ?? panel.querySelector('[data-role="assistant"]').parentElement;
  panel._flowLog=log;
  panel._flowTemplates={ user: panel.querySelector('[data-role="user"]').cloneNode(true), assistant: panel.querySelector('[data-role="assistant"]').cloneNode(true) };
  if(scenario==='ask'||scenario.startsWith('approval')) { log.innerHTML='<section class="flow-empty"><strong>How can I help?</strong><p>Ask about your notebook, explore data, or draft a query.</p><p>Summarize this notebook<br>Explain the current paragraph</p></section>'; const title=panel.querySelector('header button span:not(.hcfrxgp)'); if(title) title.textContent='New conversation'; }
  panel.firstElementChild.style.width='100%';
  const notebook=shell.querySelector('.flow-notebook');
  notebook.append(paragraph(baseCode,'','markdown'),paragraph(salesCode,rows,'sales'));
  if (scenario.startsWith('approval')) notebook.append(paragraph(groupCode,grouped,'group'));
  return {shell,notebook,panel};
}
async function ask({panel,shell}) {
  const input=panel.querySelector('textarea[aria-label="Message"]');
  await step(900); await typeInto(input, 'What does each paragraph do? Mention each paragraph id, and show the groupby line as code.');
  await step(1200); const log=panel._flowLog; log.innerHTML=''; appendMessage(panel,input.value,'user'); panel.querySelector('header button span:not(.hcfrxgp)').textContent='What does each paragraph do?'; input.value='';
  const action=actionCard(panel,'1 action','◌ Read paragraphs');
  await step(1800); action.innerHTML='<strong>1 action</strong><p>✓ Read paragraphs</p>'; transition(action);
  const reply=appendMessage(panel,'Paragraph-by-paragraph overview','assistant');
  const body=reply.querySelector('p');
  body.innerHTML='<strong>Paragraph-by-paragraph overview</strong>';
  await step(1200);
  const table=document.createElement('table');
  table.innerHTML='<thead><tr><th>Paragraph ID</th><th>Purpose</th><th>Code excerpt</th></tr></thead><tbody></tbody>';
  body.after(table); transition(table);
  for(const row of [
    ['paragraph_175955','Notebook title','%md # Sales analysis'],
    ['paragraph_175956','Load the sales data','sales = pd.DataFrame(...)'],
    ['paragraph_175957','Group revenue by region',"sales.groupby('region')['revenue'].sum()"]
  ]) { await step(1500); const tr=document.createElement('tr'); for(const value of row) {const td=document.createElement('td');td.textContent=value;tr.append(td);} table.tBodies[0].append(tr); transition(tr); }
  await step(2200);
}
async function earlier({panel}) {
  const log=panel.querySelector('[role="log"]') ?? panel.querySelector('[data-role="assistant"]').parentElement;
  for(let i=0;i<8;i++){ appendMessage(panel,`What does paragraph ${8-i} do in this notebook?`,'user');appendMessage(panel,`Paragraph ${8-i} reads notebook data and explains the result.`,'assistant'); }
  const control=document.createElement('button');control.textContent='Load earlier messages';log.prepend(control);
  await step(1600);control.textContent='Loading earlier messages…';transition(control);
  await step(1000);
  for(let i=0;i<4;i++){await step(300);const m=appendMessage(panel,`Earlier question ${i+1}`,'user');log.insertBefore(m,control.nextSibling);}
  control.textContent='Beginning of conversation';control.disabled=true;
  await step(4400);
}
async function list({panel},readonly) {
  const host=panel.firstElementChild;
  await step(700);
  const menu=document.createElement('div');menu.className='flow-list';
  menu.innerHTML='<input aria-label="Search conversations" placeholder="Search conversations"><div class="flow-row">What does each paragraph do? Mention each paragraph id…</div><div class="flow-row">Sales analysis by region</div><div class="flow-row">Another user’s conversation</div><div class="flow-row">SQL query help</div>';
  host.style.position='relative';host.append(menu);transition(menu);
  await step(1200);const search=menu.querySelector('input');await typeInto(search, readonly?'another user':'sales', 90);
  for(const row of menu.querySelectorAll('.flow-row')) row.hidden=!row.textContent.toLowerCase().includes(search.value);
  await step(1600);await menu.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-8px)'}],{duration:220}).finished;menu.remove();
  const title=panel.querySelector('header button span:not(.hcfrxgp)');
  title.textContent=readonly?'Another user’s conversation':'Sales analysis by region';
  if (readonly) { panel.querySelector('textarea').disabled=true;panel.querySelector('footer button').disabled=true;actionCard(panel,'Read-only conversation','This conversation belongs to another user. You can read its history, but cannot send messages.'); }
  else appendMessage(panel,'Summarize the revenue by region.','assistant');
  await step(3500);
}
async function approval({panel,notebook},skip) {
  const question=skip?'Load the sales data and show the top three regions.':'Show only the top three regions, highest first.';
  await step(700); const input=panel.querySelector('textarea[aria-label="Message"]'); await typeInto(input, question);
  const log=panel._flowLog; log.innerHTML=''; appendMessage(panel,question,'user'); input.value=''; panel.querySelector('header button span:not(.hcfrxgp)').textContent=question;
  const action=actionCard(panel,'2 actions','✓ Read paragraphs<br>◌ Edit paragraph');
  await step(1200);
  action.innerHTML='<strong>2 actions</strong><p>✓ Read paragraphs</p><p>◌ Edit paragraph</p><div class="flow-approval"><strong>Approval needed: Edit paragraph #3</strong><p>Review the change in the paragraph.</p><button>Allow</button><button>Skip</button></div>';
  const target=notebook.querySelector('[data-paragraph="group"]');target.classList.add('is-focused');
  const diff=document.createElement('div');diff.className='flow-diff';
  diff.innerHTML='<div class="flow-diff-head"><strong>Suggested change · 2 lines removed, 2 lines added</strong><span><button>Allow</button><button>Skip</button></span></div><del>by_region = sales.groupby(\'region\')[\'revenue\'].sum()</del><ins>by_region = sales.groupby(\'region\')[\'revenue\'].sum().sort_values(ascending=False)</ins><ins>print(by_region.head(3))</ins>';
  target.prepend(diff); transition(diff);
  notebook.scrollTo({top:target.offsetTop-notebook.offsetTop-70,behavior:'smooth'});
  await step(2600);
  if(skip) {diff.remove();action.innerHTML='<strong>Edit skipped</strong><p>The notebook was not changed or executed.</p>';await step(3500);return;}
  diff.remove();target.querySelector('.flow-code').textContent=proposedCode;
  target.animate([{backgroundColor:'#e8f8e0'},{backgroundColor:'#fff'}],{duration:850});
  action.innerHTML='<strong>Edit applied</strong><p>Execution requires separate approval.</p><div class="flow-approval"><strong>Approval needed: Run paragraph #3</strong><p>Review execution.</p><button>Allow</button><button>Skip</button></div>';transition(action);
  await step(2300);
  action.innerHTML='<strong>Execution approved</strong><p>◌ Running paragraph #3…</p>';
  await step(1300);target.querySelector('.flow-output').textContent=topThree;transition(target.querySelector('.flow-output'));
  action.innerHTML='<strong>2 actions completed</strong><p>✓ Edit paragraph</p><p>✓ Run paragraph</p>';
  appendMessage(panel,'The top three regions are South (470), West (420), and East (280).','assistant');
  await step(3300);
}
export function loopingFlow(renderScreen, theme, scenario) {
  const host=document.createElement('div');
  async function cycle() {
    while(host.isConnected) {
      const model=makeShell(renderScreen('assistant-panel--history',theme),scenario);
      host.replaceChildren(model.shell);
      if(scenario==='ask') await ask(model);
      else if(scenario==='earlier') await earlier(model);
      else if(scenario==='list'||scenario==='readonly') await list(model,scenario==='readonly');
      else await approval(model,scenario==='approval-skip');
      await step(900);
    }
  }
  requestAnimationFrame(()=>{void cycle();});
  return host;
}
