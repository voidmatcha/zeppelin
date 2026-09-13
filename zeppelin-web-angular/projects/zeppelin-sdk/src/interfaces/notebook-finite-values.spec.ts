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

import { expect, expectTypeOf, it } from 'vitest';

import {
  DatasetType,
  InterpreterResultCode,
  ParagraphItem,
  ParagraphResults,
  ParagraphStatusValue
} from './message-paragraph.interface';

it('enumerates every paragraph status sent by Job.Status', () => {
  expectTypeOf<ParagraphItem['status']>().toEqualTypeOf<ParagraphStatusValue>();

  const statuses = ['UNKNOWN', 'READY', 'PENDING', 'RUNNING', 'FINISHED', 'ERROR', 'ABORT'] as const;
  expectTypeOf<(typeof statuses)[number]>().toEqualTypeOf<ParagraphStatusValue>();
  expect(new Set(statuses).size).toBe(7);
});

it('enumerates every interpreter result code', () => {
  const codes = ['SUCCESS', 'INCOMPLETE', 'ERROR', 'KEEP_PREVIOUS_RESULT'] as const;
  expectTypeOf<(typeof codes)[number]>().toEqualTypeOf<InterpreterResultCode>();
  expectTypeOf<ParagraphResults['code']>().toEqualTypeOf<InterpreterResultCode | undefined>();
  expect(new Set(codes).size).toBe(4);
});

it('includes every interpreter result dataset type', () => {
  expect(Object.values(DatasetType)).toEqual(['NETWORK', 'TABLE', 'HTML', 'TEXT', 'ANGULAR', 'IMG', 'SVG', 'NULL']);
});
