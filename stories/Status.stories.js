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
export default { title: "Assistant/Status" };
export const Streaming = { name: "Streaming", render: (_args, context) => renderScreen("assistant-status--streaming", context.globals.theme) };
export const Loading = { name: "Loading", render: (_args, context) => renderScreen("assistant-status--loading", context.globals.theme) };
export const Completed = { name: "Completed", render: (_args, context) => renderScreen("assistant-status--completed", context.globals.theme) };
export const Error = { name: "Error", render: (_args, context) => renderScreen("assistant-status--error", context.globals.theme) };
export const EarlierMessages = { name: "Earlier Messages", render: (_args, context) => renderScreen("assistant-status--earlier-messages", context.globals.theme) };
export const LoadingEarlier = { name: "Loading Earlier", render: (_args, context) => renderScreen("assistant-status--loading-earlier", context.globals.theme) };
export const NewReply = { name: "New Reply", render: (_args, context) => renderScreen("assistant-status--new-reply", context.globals.theme) };
