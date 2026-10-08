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
export default { title: "Assistant/ConversationList" };
export const Conversations = { name: "Conversations", render: (_args, context) => renderScreen("assistant-conversationlist--conversations", context.globals.theme) };
export const Empty = { name: "Empty", render: (_args, context) => renderScreen("assistant-conversationlist--empty", context.globals.theme) };
export const Busy = { name: "Busy", render: (_args, context) => renderScreen("assistant-conversationlist--busy", context.globals.theme) };
export const SelectAndDelete = { name: "Select And Delete", render: (_args, context) => renderScreen("assistant-conversationlist--select-and-delete", context.globals.theme) };
export const Search = { name: "Search", render: (_args, context) => renderScreen("assistant-conversationlist--search", context.globals.theme) };
