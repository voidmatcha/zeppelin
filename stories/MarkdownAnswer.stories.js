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
export default { title: "Assistant/MarkdownAnswer" };
export const GfmTable = { name: "Gfm Table", render: (_args, context) => renderScreen("assistant-markdownanswer--gfm-table", context.globals.theme) };
export const SqlCode = { name: "Sql Code", render: (_args, context) => renderScreen("assistant-markdownanswer--sql-code", context.globals.theme) };
export const PartialFence = { name: "Partial Fence", render: (_args, context) => renderScreen("assistant-markdownanswer--partial-fence", context.globals.theme) };
export const ParagraphReference = { name: "Paragraph Reference", render: (_args, context) => renderScreen("assistant-markdownanswer--paragraph-reference", context.globals.theme) };
