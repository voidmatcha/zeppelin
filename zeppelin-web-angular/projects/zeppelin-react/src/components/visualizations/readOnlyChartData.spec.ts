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
import { GraphConfig, VisualizationStackedAreaChart } from '@zeppelin/sdk';
import { readOnlyChartData, supportsReadOnlyChart } from './readOnlyChartData';

describe('readOnlyChartData', () => {
  it('keeps Helium and unsupported area styles on the default notebook route', () => {
    const graph = new GraphConfig();
    graph.mode = 'helium-custom';
    expect(supportsReadOnlyChart(graph)).toBe(false);
    graph.mode = 'stackedAreaChart';
    graph.setting.stackedAreaChart = new VisualizationStackedAreaChart();
    graph.setting.stackedAreaChart.style = 'stream';
    expect(supportsReadOnlyChart(graph)).toBe(false);
    graph.setting.stackedAreaChart.style = 'stack';
    expect(supportsReadOnlyChart(graph)).toBe(true);
    graph.mode = 'pieChart';
    graph.groups = [{ name: 'team', index: 1, aggr: 'sum' }];
    expect(supportsReadOnlyChart(graph)).toBe(false);
    graph.groups = [];
    graph.values = [
      { name: 'sales', index: 1, aggr: 'sum' },
      { name: 'cost', index: 2, aggr: 'sum' }
    ];
    expect(supportsReadOnlyChart(graph)).toBe(false);
  });

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
        { label: 'amount(sum) / A', values: [5, null] },
        { label: 'amount(sum) / B', values: [null, 4] }
      ]
    });
    expect(graph).toEqual(original);
  });

  it('fills absent groups with zero only for stacked area charts', () => {
    const graph = new GraphConfig();
    graph.mode = 'stackedAreaChart';
    graph.keys = [{ name: 'city', index: 0, aggr: 'sum' }];
    graph.groups = [{ name: 'team', index: 1, aggr: 'sum' }];
    graph.values = [{ name: 'amount', index: 2, aggr: 'sum' }];

    expect(
      readOnlyChartData(
        {
          columnNames: ['city', 'team', 'amount'],
          rows: [
            ['Seoul', 'A', '10'],
            ['Busan', 'B', '20']
          ]
        },
        graph
      ).series
    ).toEqual([
      { label: 'amount(sum) / A', values: [10, 0] },
      { label: 'amount(sum) / B', values: [0, 20] }
    ]);
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
      { label: 'amount(sum) / East / A', values: [2] },
      { label: 'amount(sum) / East / B', values: [3] }
    ]);
  });

  it('keeps different aggregations of the same saved value separate', () => {
    const graph = new GraphConfig();
    graph.mode = 'multiBarChart';
    graph.keys = [{ name: 'city', index: 0, aggr: 'sum' }];
    graph.values = [
      { name: 'amount', index: 1, aggr: 'sum' },
      { name: 'amount', index: 1, aggr: 'avg' }
    ];

    expect(
      readOnlyChartData(
        {
          columnNames: ['city', 'amount'],
          rows: [
            ['Seoul', '2'],
            ['Seoul', '4']
          ]
        },
        graph
      ).series
    ).toEqual([
      { label: 'amount(sum)', values: [6] },
      { label: 'amount(avg)', values: [3] }
    ]);
  });

  it('does not count a duplicate saved value mapping twice', () => {
    const graph = new GraphConfig();
    graph.mode = 'multiBarChart';
    graph.keys = [{ name: 'city', index: 0, aggr: 'sum' }];
    graph.values = [
      { name: 'amount', index: 1, aggr: 'sum' },
      { name: 'amount', index: 1, aggr: 'sum' }
    ];

    expect(
      readOnlyChartData(
        {
          columnNames: ['city', 'amount'],
          rows: [
            ['Seoul', '2'],
            ['Seoul', '4']
          ]
        },
        graph
      ).series
    ).toEqual([{ label: 'amount(sum)', values: [6] }]);
  });

  it('does not invent a key column when saved values have no keys', () => {
    const graph = new GraphConfig();
    graph.mode = 'multiBarChart';
    graph.values = [{ name: 'amount', index: 1, aggr: 'sum' }];

    expect(
      readOnlyChartData(
        {
          columnNames: ['city', 'amount'],
          rows: [
            ['Seoul', '2'],
            ['Busan', '4']
          ]
        },
        graph
      )
    ).toMatchObject({ labels: [''], series: [{ label: 'amount(sum)', values: [6] }] });
  });
});
