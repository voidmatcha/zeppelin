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

import { assertType, expectTypeOf, it } from 'vitest';

import { MessageReceiveDataTypeMap, MessageSendDataTypeMap } from './message-data-type-map.interface';
import { OP } from './message-operator.interface';
import { DatasetType, ParagraphAppendOutput, ParagraphUpdateOutput } from './message-paragraph.interface';

it('declares the asymmetric paragraph output payloads sent by the server', () => {
  const append: MessageReceiveDataTypeMap[OP.PARAGRAPH_APPEND_OUTPUT] = {
    noteId: 'note',
    paragraphId: 'paragraph',
    index: 0,
    data: 'chunk'
  };
  assertType<MessageReceiveDataTypeMap[OP.PARAGRAPH_UPDATE_OUTPUT]>({
    ...append,
    type: DatasetType.TEXT
  });
  expectTypeOf<MessageReceiveDataTypeMap[OP.PARAGRAPH_APPEND_OUTPUT]>().toEqualTypeOf<ParagraphAppendOutput>();
  expectTypeOf<MessageReceiveDataTypeMap[OP.PARAGRAPH_APPEND_OUTPUT]>().not.toHaveProperty('type');
  expectTypeOf<MessageReceiveDataTypeMap[OP.PARAGRAPH_UPDATE_OUTPUT]>().toEqualTypeOf<ParagraphUpdateOutput>();
  expectTypeOf<MessageReceiveDataTypeMap[OP.PARAGRAPH_UPDATE_OUTPUT]>()
    .toHaveProperty('type')
    .toEqualTypeOf<DatasetType>();
});

it('accepts both attributed and legacy structural paragraph payloads', () => {
  const added: MessageReceiveDataTypeMap[OP.PARAGRAPH_ADDED] = {
    noteId: 'note',
    index: 0,
    paragraph: {
      id: 'paragraph',
      text: '',
      status: 'READY'
    } as MessageReceiveDataTypeMap[OP.PARAGRAPH_ADDED]['paragraph']
  };
  const moved: MessageReceiveDataTypeMap[OP.PARAGRAPH_MOVED] = { noteId: 'note', id: 'paragraph', index: 1 };
  const removed: MessageReceiveDataTypeMap[OP.PARAGRAPH_REMOVED] = { id: 'paragraph' };
  expectTypeOf(added.noteId).toEqualTypeOf<string | undefined>();
  expectTypeOf(moved.noteId).toEqualTypeOf<string | undefined>();
  expectTypeOf(removed.noteId).toEqualTypeOf<string | undefined>();
});

it('models attributed collaboration and note updates while accepting legacy broadcasts', () => {
  const patch: MessageReceiveDataTypeMap[OP.PATCH_PARAGRAPH] = {
    noteId: 'note',
    paragraphId: 'paragraph',
    patch: '@@ -0,0 +1 @@\n+a\n'
  };
  const legacyPatch: MessageReceiveDataTypeMap[OP.PATCH_PARAGRAPH] = {
    paragraphId: 'paragraph',
    patch: patch.patch
  };
  const updated: MessageReceiveDataTypeMap[OP.NOTE_UPDATED] = {
    name: 'Note',
    config: {} as MessageReceiveDataTypeMap[OP.NOTE_UPDATED]['config'],
    info: {} as MessageReceiveDataTypeMap[OP.NOTE_UPDATED]['info']
  };
  const status: MessageReceiveDataTypeMap[OP.COLLABORATIVE_MODE_STATUS] = { status: true, users: [] };

  expectTypeOf(patch.paragraphId).toEqualTypeOf<string>();
  expectTypeOf(legacyPatch.noteId).toEqualTypeOf<string | undefined>();
  expectTypeOf(updated.noteId).toEqualTypeOf<string | undefined>();
  expectTypeOf(status.noteId).toEqualTypeOf<string | undefined>();
  assertType<MessageSendDataTypeMap[OP.PATCH_PARAGRAPH]>({
    id: 'paragraph',
    noteId: 'note',
    patch: patch.patch
  });
});
