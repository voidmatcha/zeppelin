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
import { describe, expect, it } from 'vitest';

import { TableData } from './table-data';

describe('TableData duplicate headers', () => {
  it('keeps both values while preserving the displayed header names', () => {
    const table = new TableData();
    table.loadParagraphResult({
      type: DatasetType.TABLE,
      data: 'name\tname\nfirst\tsecond'
    } as ParagraphIResultsMsgItem);

    expect(table.displayColumns).toEqual(['name', 'name']);
    expect(table.columns).toEqual(['name', 'name (2)']);
    expect(table.rows).toEqual([{ name: 'first', 'name (2)': 'second' }]);
  });

  it('avoids colliding with an existing suffixed header', () => {
    const table = new TableData();
    table.loadParagraphResult({
      type: DatasetType.TABLE,
      data: 'name\tname\tname (2)\nfirst\tsecond\tthird'
    } as ParagraphIResultsMsgItem);

    expect(table.columns).toEqual(['name', 'name (3)', 'name (2)']);
    expect(table.rows).toEqual([{ name: 'first', 'name (3)': 'second', 'name (2)': 'third' }]);
  });

  it('does not expose carriage returns in CRLF headers', () => {
    const table = new TableData();
    table.loadParagraphResult({ type: DatasetType.TABLE, data: 'a\tb\r\n1\t2' } as ParagraphIResultsMsgItem);

    expect(table.displayColumns).toEqual(['a', 'b']);
    expect(table.columns).toEqual(['a', 'b']);
  });

  it('keeps the parsed display name of a quoted header', () => {
    const table = new TableData();
    table.loadParagraphResult({
      type: DatasetType.TABLE,
      data: '"name"\t"name"\nfirst\tsecond'
    } as ParagraphIResultsMsgItem);

    expect(table.displayColumns).toEqual(['name', 'name']);
    expect(table.rows).toEqual([{ name: 'first', 'name (2)': 'second' }]);
  });
});
