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

import { describe, expect, it } from 'vitest';

import { AngularObjectRemove } from '../interfaces/message-paragraph.interface';
import { getAngularObjectRemoveName } from './angular-object';

const nestedPayload: AngularObjectRemove = {
  noteId: 'note',
  paragraphId: 'paragraph',
  interpreterGroupId: 'group',
  angularObject: {
    name: 'nested-name',
    object: 'value',
    noteId: 'note',
    paragraphId: 'paragraph'
  }
};

describe('getAngularObjectRemoveName', () => {
  it('uses the top-level name payload', () => {
    expect(getAngularObjectRemoveName({ noteId: 'note', paragraphId: 'paragraph', name: 'top-level-name' })).toBe(
      'top-level-name'
    );
  });

  it('uses angularObject.name for the client-unbind payload', () => {
    expect(getAngularObjectRemoveName(nestedPayload)).toBe('nested-name');
  });

  it('prefers a top-level name when a compatibility payload contains both forms', () => {
    expect(getAngularObjectRemoveName({ ...nestedPayload, name: 'top-level-name' })).toBe('top-level-name');
  });

  it.each([
    ['a null payload', null],
    ['an undefined payload', undefined],
    ['a primitive payload', 'name'],
    ['a missing name', { noteId: 'note', paragraphId: 'paragraph' }],
    ['a null angular object', { ...nestedPayload, angularObject: null }],
    ['a malformed angular object', { ...nestedPayload, angularObject: { name: 1 } }]
  ])('returns undefined for %s', (_description, payload) => {
    expect(getAngularObjectRemoveName(payload)).toBeUndefined();
  });
});
