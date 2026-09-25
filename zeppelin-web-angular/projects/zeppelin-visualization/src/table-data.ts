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

// @ts-ignore: TODO - Should write type declaration file.
import { DataSet as AntvDataSet } from '@antv/data-set';

import { DatasetType, ParagraphIResultsMsgItem } from '@zeppelin/sdk';
import { DataSet } from './data-set';

export class TableData extends DataSet {
  columns: string[] = [];
  displayColumns: string[] = [];
  // eslint-disable-next-line
  rows: any[] = [];

  loadParagraphResult({ data, type }: ParagraphIResultsMsgItem): void {
    if (type !== DatasetType.TABLE) {
      console.error('Can not load paragraph result');
      return;
    }
    const ds = new AntvDataSet();
    let dv = ds.createView().source(data, { type: 'tsv' });
    const displayColumns: string[] = dv.origin?.columns || [];
    const reservedNames = new Set(displayColumns);
    const usedNames = new Set<string>();
    const columns = displayColumns.map(name => {
      let key = name;
      let suffix = 2;
      while (usedNames.has(key)) {
        key = `${name} (${suffix++})`;
        while (reservedNames.has(key)) {
          key = `${name} (${suffix++})`;
        }
      }
      usedNames.add(key);
      return key;
    });
    if (columns.some((name, index) => name !== displayColumns[index])) {
      const firstLineEnd = data.indexOf('\n');
      const escapeHeader = (name: string) => (/[\t"\r\n]/.test(name) ? `"${name.replace(/"/g, '""')}"` : name);
      const uniqueHeader = columns.map(escapeHeader).join('\t');
      const source = uniqueHeader + (firstLineEnd === -1 ? '' : data.slice(firstLineEnd));
      dv = ds.createView().source(source, { type: 'tsv' });
    }
    this.columns = dv.origin && dv.origin.columns ? dv.origin.columns : [];
    this.displayColumns = displayColumns;
    this.rows = dv.rows || [];
  }
}
