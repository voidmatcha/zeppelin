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

import { DatasetType, ParagraphIResultsMsgItem } from '@zeppelin/sdk';

export class ParagraphOutputState {
  private results: ParagraphIResultsMsgItem[] = [];
  private readonly pendingAppends = new Map<number, string>();
  private readonly hiddenResults = new Set<number>();
  private initialized = false;
  private terminal = false;

  get isInitialized(): boolean {
    return this.initialized;
  }

  reset(results: ParagraphIResultsMsgItem[] = [], terminal = false): void {
    this.results = results.map(result => ({ ...result }));
    this.pendingAppends.clear();
    this.hiddenResults.clear();
    this.initialized = true;
    this.terminal = terminal;
  }

  clearPreservingTypes(): void {
    this.pendingAppends.clear();
    this.results = this.results.map((result, index) => {
      this.hiddenResults.add(index);
      return { ...result, data: '' };
    });
  }

  isHidden(index: number): boolean {
    return this.hiddenResults.has(index);
  }

  finish(results: ParagraphIResultsMsgItem[] = []): void {
    this.reset(results, true);
  }

  update(index: number, type: DatasetType, data: string): ParagraphIResultsMsgItem | undefined {
    if (this.terminal) {
      return undefined;
    }

    const result = {
      type,
      data: data + (this.pendingAppends.get(index) ?? '')
    };
    this.pendingAppends.delete(index);
    this.results[index] = result;
    this.hiddenResults.delete(index);
    return result;
  }

  append(index: number, data: string): ParagraphIResultsMsgItem | undefined {
    if (this.terminal) {
      return undefined;
    }

    const current = this.results[index];
    if (!current) {
      this.pendingAppends.set(index, (this.pendingAppends.get(index) ?? '') + data);
      return undefined;
    }

    const result = {
      ...current,
      data: current.data + data
    };
    this.results[index] = result;
    this.hiddenResults.delete(index);
    return result;
  }

  snapshot(): ParagraphIResultsMsgItem[] {
    // Keep server indexes stable: a later slot cannot be rendered before missing
    // earlier slots acquire their types. Retain those later slots for subsequent updates.
    let length = 0;
    while (this.results[length]) {
      length++;
    }
    return this.results.slice(0, length);
  }
}
