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

import { ChangeDetectorRef } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { Visualization } from '@zeppelin/visualization';

import { TableVisualizationComponent } from './table-visualization.component';

const createComponent = (rowCount: number) => {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: String(i + 1) }));
  const visualization = { transformed: { columns: ['id'], rows } } as unknown as Visualization;
  const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;
  return new TableVisualizationComponent(visualization, cdr);
};

describe('TableVisualizationComponent page index clamp', () => {
  it('moves to the last page when a rerun returns fewer rows than the current page needs', () => {
    const component = createComponent(5);
    component.pageIndex = 3;

    component.render();

    expect(component.pageIndex).toBe(1);
  });

  it('falls back to the first page when a filter matches no rows', () => {
    const component = createComponent(25);
    component.render();
    component.pageIndex = 2;

    component.onTermChange('id', 'no-such-value');
    component.onSearch();

    expect(component.rows).toEqual([]);
    expect(component.pageIndex).toBe(1);
  });

  it('keeps a page index that is still in range', () => {
    const component = createComponent(25);
    component.pageIndex = 3;

    component.render();

    expect(component.pageIndex).toBe(3);
  });
});
