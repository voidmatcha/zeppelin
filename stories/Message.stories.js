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
export default { title: "Assistant/Message" };
export const CompletedReply = { name: "Completed Reply", render: (_args, context) => renderScreen("assistant-message--completed-reply", context.globals.theme) };
export const StreamingReply = { name: "Streaming Reply", render: (_args, context) => renderScreen("assistant-message--streaming-reply", context.globals.theme) };
export const FromHistory = { name: "From History", render: (_args, context) => renderScreen("assistant-message--from-history", context.globals.theme) };
export const User = { name: "User", render: (_args, context) => renderScreen("assistant-message--user", context.globals.theme) };
export const Conversation = { name: "Conversation", render: (_args, context) => renderScreen("assistant-message--conversation", context.globals.theme) };
