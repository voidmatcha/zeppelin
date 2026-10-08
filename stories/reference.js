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
const screens = import.meta.glob('../public/screens/*.html', { query: '?raw', import: 'default', eager: true });
export function renderScreen(id, theme) {
  const html = screens[`../public/screens/${id}-${theme === 'dark' ? 'dark' : 'light'}.html`];
  if (!html) throw new Error(`Missing reference screen: ${id}`);
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}
