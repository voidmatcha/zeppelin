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

export type DiffLine =
  | { kind: 'same'; text: string; before: number; after: number }
  | { kind: 'removed'; text: string; before: number }
  | { kind: 'added'; text: string; after: number };

/**
 * Line diff of a paragraph edit (longest common subsequence). Paragraphs are short, so the
 * quadratic table is fine; line numbers are 1-based on their own side.
 */
export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before.split('\n');
  const b = after.split('\n');
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i], before: i + 1, after: j + 1 });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || common[i][j + 1] > common[i + 1][j])) {
      lines.push({ kind: 'added', text: b[j], after: j + 1 });
      j++;
    } else {
      lines.push({ kind: 'removed', text: a[i], before: i + 1 });
      i++;
    }
  }
  return lines;
};
