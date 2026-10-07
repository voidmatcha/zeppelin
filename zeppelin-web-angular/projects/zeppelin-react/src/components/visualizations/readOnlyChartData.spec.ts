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

import { describe, expect, it } from 'vitest';
import { GraphConfig } from '@zeppelin/sdk';
import { readOnlyChartData } from './readOnlyChartData';

describe('readOnlyChartData', () => {
  it('uses saved key, group and value columns with aggregation instead of the first two columns', () => {
    const graph = new GraphConfig();
    graph.mode = 'multiBarChart';
    graph.keys = [{ name: 'city', index: 2, aggr: 'sum' }];
    graph.groups = [{ name: 'team', index: 0, aggr: 'sum' }];
    graph.values = [{ name: 'amount', index: 3, aggr: 'sum' }];
    const original = structuredClone(graph);

    expect(
      readOnlyChartData(
        {
          columnNames: ['team', 'unused', 'city', 'amount'],
          rows: [
            ['A', '8', 'Seoul', '2'],
            ['A', '9', 'Seoul', '3'],
            ['B', '7', 'Busan', '4']
          ]
        },
        graph
      )
    ).toMatchObject({
      labels: ['Seoul', 'Busan'],
      series: [
        { label: 'amount / A', values: [5, 0] },
        { label: 'amount / B', values: [0, 4] }
      ]
    });
    expect(graph).toEqual(original);
  });

  it('honors saved scatter axes, group and size columns', () => {
    const graph = new GraphConfig();
    graph.mode = 'scatterChart';
    graph.setting.scatterChart = {
      xAxis: { name: 'x', index: 2, aggr: 'sum' },
      yAxis: { name: 'y', index: 3, aggr: 'sum' },
      group: { name: 'team', index: 0, aggr: 'sum' },
      size: { name: 'size', index: 4, aggr: 'sum' }
    };

    expect(
      readOnlyChartData(
        { columnNames: ['team', 'unused', 'x', 'y', 'size'], rows: [['A', '999', '2', '3', '8']] },
        graph
      ).scatter
    ).toEqual([{ label: 'A', points: [{ x: 2, y: 3, radius: 8 }] }]);
  });

  it('keeps every saved group column distinct', () => {
    const graph = new GraphConfig();
    graph.mode = 'multiBarChart';
    graph.keys = [{ name: 'city', index: 0, aggr: 'sum' }];
    graph.groups = [
      { name: 'region', index: 1, aggr: 'sum' },
      { name: 'team', index: 2, aggr: 'sum' }
    ];
    graph.values = [{ name: 'amount', index: 3, aggr: 'sum' }];

    expect(
      readOnlyChartData(
        {
          columnNames: ['city', 'region', 'team', 'amount'],
          rows: [
            ['Seoul', 'East', 'A', '2'],
            ['Seoul', 'East', 'B', '3']
          ]
        },
        graph
      ).series
    ).toEqual([
      { label: 'amount / East / A', values: [2] },
      { label: 'amount / East / B', values: [3] }
    ]);
  });
});
