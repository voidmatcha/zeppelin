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
import { TableData } from '@zeppelin/visualization';
import { describe, expect, it } from 'vitest';

import { TableDataAdapterService } from './table-data-adapter.service';

describe('TableDataAdapterService duplicate headers', () => {
  it('passes separate values and original labels to classic Helium visualizations', () => {
    const table = new TableData();
    table.loadParagraphResult({
      type: DatasetType.TABLE,
      data: 'name\tname\nfirst\tsecond'
    } as ParagraphIResultsMsgItem);

    const classic = new TableDataAdapterService().convertToClassicFormat(table);

    expect(classic.columns.map(column => column.name)).toEqual(['name', 'name']);
    expect(classic.rows).toEqual([['first', 'second']]);
  });
});
