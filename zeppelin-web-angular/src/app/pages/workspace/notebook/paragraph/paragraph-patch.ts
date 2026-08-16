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

import { diff_match_patch } from 'diff-match-patch';

interface ParagraphPatch {
  patch: string;
  nextOriginalText: string;
}

/**
 * An empty string is a valid paragraph state, so only an unset dirtyText is rejected.
 */
export function createParagraphPatch(
  diffMatchPatch: InstanceType<typeof diff_match_patch>,
  originalText: string | undefined,
  dirtyText: string | undefined
): ParagraphPatch {
  if (dirtyText === undefined) {
    throw new Error('dirtyText is required');
  }

  return {
    patch: diffMatchPatch.patch_make(originalText ?? '', dirtyText).toString(),
    nextOriginalText: dirtyText
  };
}
