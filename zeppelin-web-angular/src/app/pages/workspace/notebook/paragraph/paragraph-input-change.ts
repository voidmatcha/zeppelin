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

import { SimpleChanges } from '@angular/core';

export const shouldHydrateParagraphInput = (changes: SimpleChanges): boolean => {
  if (changes.note) {
    return true;
  }
  const paragraph = changes.paragraph;
  return Boolean(paragraph && paragraph.previousValue?.id !== paragraph.currentValue?.id);
};

export const preserveExistingParagraphViews = <T extends Readonly<{ id: string }>>(
  current: readonly T[],
  projected: readonly T[]
): readonly T[] => {
  const currentById = new Map(current.map(paragraph => [paragraph.id, paragraph]));
  return projected.map(paragraph => currentById.get(paragraph.id) ?? paragraph);
};
