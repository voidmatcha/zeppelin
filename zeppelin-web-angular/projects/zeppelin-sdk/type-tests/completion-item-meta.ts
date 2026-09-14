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

import type { CompletionItem } from '../src/interfaces/message-paragraph.interface';

const completionWithoutMeta: CompletionItem = {
  name: 'count',
  value: 'count'
};

const completionWithMeta: CompletionItem = {
  name: 'count',
  value: 'count',
  meta: 'function'
};

// @ts-expect-error name remains required
const completionWithoutName: CompletionItem = { value: 'count' };

// @ts-expect-error value remains required
const completionWithoutValue: CompletionItem = { name: 'count' };

void [completionWithoutMeta, completionWithMeta, completionWithoutName, completionWithoutValue];
