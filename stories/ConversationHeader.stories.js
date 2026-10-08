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
export default { title: "Assistant/ConversationHeader" };
export const Current = { name: "Current", render: (_args, context) => renderScreen("assistant-conversationheader--current", context.globals.theme) };
export const ReadOnly = { name: "Read Only", render: (_args, context) => renderScreen("assistant-conversationheader--read-only", context.globals.theme) };
export const NewConversation = { name: "New Conversation", render: (_args, context) => renderScreen("assistant-conversationheader--new-conversation", context.globals.theme) };
export const Busy = { name: "Busy", render: (_args, context) => renderScreen("assistant-conversationheader--busy", context.globals.theme) };
