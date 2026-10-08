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
import { renderScreen } from './reference.js';
export default { title: "Assistant/Composer" };
export const Empty = { name: "Empty", render: (_args, context) => renderScreen("assistant-composer--empty", context.globals.theme) };
export const Draft = { name: "Draft", render: (_args, context) => renderScreen("assistant-composer--draft", context.globals.theme) };
export const Running = { name: "Running", render: (_args, context) => renderScreen("assistant-composer--running", context.globals.theme) };
export const ReadOnly = { name: "Read Only", render: (_args, context) => renderScreen("assistant-composer--read-only", context.globals.theme) };
export const DraftSaveError = { name: "Draft Save Error", render: (_args, context) => renderScreen("assistant-composer--draft-save-error", context.globals.theme) };
export const Send = { name: "Send", render: (_args, context) => renderScreen("assistant-composer--send", context.globals.theme) };
