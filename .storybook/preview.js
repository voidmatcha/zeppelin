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
import '../public/reference.css';
import '../public/demo.css';
import '../public/flow.css';
export default {
  initialGlobals: { theme: 'light' },
  globalTypes: { theme: { toolbar: { icon: 'circlehollow', items: ['light', 'dark'], dynamicTitle: true } } },
  decorators: [(story, context) => {
    document.documentElement.dataset.theme = context.globals.theme;
    document.body.style.backgroundColor = context.globals.theme === 'dark' ? '#141414' : '#fff';
    return story();
  }],
  parameters: { layout: 'padded' }
};
