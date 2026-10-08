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

import type { SavedGraphConfig } from './result-types';
import type { TableData } from '@/utils/tableUtils';

type Aggregate = { sum: number; count: number; min: number; max: number };

export type ReadOnlyChartData = {
  labels: string[];
  series: { label: string; values: (number | null)[] }[];
  scatter: { label: string; points: { x: number; y: number; radius: number }[] }[];
};

const savedChartModes = new Set([
  'table',
  'multiBarChart',
  'lineChart',
  'stackedAreaChart',
  'pieChart',
  'scatterChart'
]);

export const supportsReadOnlyChart = (graph: SavedGraphConfig | undefined): boolean => {
  if (!graph?.mode) return true;
  if (!savedChartModes.has(graph.mode)) return false;
  if (graph.mode === 'pieChart' && (graph.groups?.length || (graph.values?.length ?? 0) > 1)) return false;
  return (
    graph.mode !== 'stackedAreaChart' ||
    !['stream', 'expand'].includes(graph.setting?.stackedAreaChart?.style ?? 'stack')
  );
};

const number = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const columnIndex = (data: TableData, name: string | undefined, fallback: number): number => {
  const index = name === undefined ? -1 : data.columnNames.indexOf(name);
  return index < 0 ? fallback : index;
};

const aggregateValue = (aggregate: Aggregate, operation: string): number => {
  switch (operation) {
    case 'count':
      return aggregate.count;
    case 'avg':
    case 'mean':
      return aggregate.sum / aggregate.count;
    case 'min':
      return aggregate.min;
    case 'max':
      return aggregate.max;
    default:
      return aggregate.sum;
  }
};

/** Reconstruct saved chart mappings without mutating the host-owned Core snapshot. */
export const readOnlyChartData = (data: TableData, graph: SavedGraphConfig): ReadOnlyChartData => {
  if (graph.mode === 'scatterChart') {
    const setting = graph.setting?.scatterChart;
    const xIndex = columnIndex(data, setting?.xAxis?.name, 0);
    const yIndex = columnIndex(data, setting?.yAxis?.name, 1);
    const groupIndex = columnIndex(data, setting?.group?.name, -1);
    const sizeIndex = columnIndex(data, setting?.size?.name, -1);
    const groups = new Map<string, { x: number; y: number; radius: number }[]>();
    for (const row of data.rows) {
      const group = groupIndex < 0 ? 'Value' : row[groupIndex] || 'None';
      const points = groups.get(group) ?? [];
      points.push({
        x: number(row[xIndex]),
        y: number(row[yIndex]),
        radius: sizeIndex < 0 ? 4 : Math.max(2, number(row[sizeIndex]))
      });
      groups.set(group, points);
    }
    return {
      labels: [],
      series: [],
      scatter: Array.from(groups).map(([label, points]) => ({ label, points }))
    };
  }

  const useDefaultMapping = !graph.keys?.length && !graph.groups?.length && !graph.values?.length;
  const keys = (graph.keys ?? []).map(key => columnIndex(data, key.name, -1)).filter(index => index >= 0);
  if (useDefaultMapping && data.columnNames[0]) keys.push(0);
  const groupIndexes = (graph.groups ?? []).map(group => columnIndex(data, group.name, -1)).filter(index => index >= 0);
  const values = (graph.values ?? [])
    .map(value => ({ name: value.name, index: columnIndex(data, value.name, -1), aggr: value.aggr }))
    .filter(value => value.index >= 0)
    .filter(
      (value, index, all) =>
        all.findIndex(candidate => candidate.index === value.index && candidate.aggr === value.aggr) === index
    );
  if (useDefaultMapping && data.columnNames[1]) {
    values.push({ name: data.columnNames[1], index: 1, aggr: 'sum' });
  }
  const labels: string[] = [];
  const series = new Map<string, { aggr: string; buckets: Map<string, Aggregate> }>();

  for (const row of data.rows) {
    const key = keys.map(index => row[index] ?? '').join(' / ');
    if (!labels.includes(key)) labels.push(key);
    const group = groupIndexes.map(index => row[index] ?? '').join(' / ');
    for (const value of values) {
      const field = `${value.name}(${value.aggr})`;
      const label = group ? `${field} / ${group}` : field;
      const entry = series.get(label) ?? { aggr: value.aggr, buckets: new Map<string, Aggregate>() };
      const buckets = entry.buckets;
      const current = buckets.get(key);
      const numeric = number(row[value.index]);
      buckets.set(key, {
        sum: (current?.sum ?? 0) + numeric,
        count: (current?.count ?? 0) + 1,
        min: Math.min(current?.min ?? numeric, numeric),
        max: Math.max(current?.max ?? numeric, numeric)
      });
      series.set(label, entry);
    }
  }

  return {
    labels,
    series: Array.from(series).map(([label, { aggr, buckets }]) => ({
      label,
      values: labels.map(key => {
        const aggregate = buckets.get(key);
        return aggregate ? aggregateValue(aggregate, aggr) : graph.mode === 'stackedAreaChart' ? 0 : null;
      })
    })),
    scatter: []
  };
};
