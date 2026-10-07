// @vitest-environment node

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

import { expectTypeOf, it } from 'vitest';

import type {
  NotebookCoreWireNote,
  NotebookCoreWirePermissions,
  NotebookCoreWireRevision
} from '../../projects/zeppelin-notebook-core/src/public-api';
import type { Note, NoteRevision } from '../../projects/zeppelin-sdk/src/interfaces/message-notebook.interface';
import type { Permissions } from '../../src/app/interfaces/security';

it('accepts the existing SDK NOTE and REST permissions without importing them into Core', () => {
  expectTypeOf<NonNullable<Note['note']>>().toExtend<NotebookCoreWireNote>();
  expectTypeOf<Permissions>().toExtend<NotebookCoreWirePermissions>();
  expectTypeOf<NoteRevision>().toExtend<NotebookCoreWireRevision>();
});
