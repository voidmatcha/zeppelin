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

import { applyChartTheme, useHostThemeMode } from '@/theme';
import { exportFile, parseTableData, type TableData } from '@/utils';
import type { NotebookParagraphResult, NotebookParagraphResultConfig } from '@zeppelin/notebook-core';
import { Table } from 'antd';
import type { Chart, ChartConfiguration, ChartDataset } from 'chart.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { VisualizationControls, type VisualizationMode } from './VisualizationControls';

interface TableVisualizationProps {
  result: NotebookParagraphResult;
  config?: NotebookParagraphResultConfig;
  modeChangeDisabled?: boolean;
  onConfigChange?: (config: NotebookParagraphResultConfig) => void;
}

type GraphColumn = Readonly<{ name?: unknown; index?: unknown }>;
type GraphConfigRecord = Record<string, unknown>;

const CHART_COLORS = [
  '#1890ff',
  '#2fc25b',
  '#facc14',
  '#223273',
  '#8543e0',
  '#13c2c2',
  '#3436c7',
  '#f04864'
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isVisualizationMode = (value: unknown): value is VisualizationMode =>
  value === 'table' ||
  value === 'multiBarChart' ||
  value === 'pieChart' ||
  value === 'lineChart' ||
  value === 'stackedAreaChart' ||
  value === 'scatterChart';

const getGraphConfig = (config?: NotebookParagraphResultConfig): GraphConfigRecord =>
  isRecord(config?.graph) ? config.graph : {};

const getConfiguredMode = (config?: NotebookParagraphResultConfig): VisualizationMode => {
  const mode = getGraphConfig(config).mode;
  return isVisualizationMode(mode) ? mode : 'table';
};

const getColumnConfigs = (graph: GraphConfigRecord, property: 'keys' | 'groups' | 'values'): GraphColumn[] => {
  const value = graph[property];
  return Array.isArray(value) ? value.filter(isRecord) : [];
};

const resolveColumnIndex = (column: GraphColumn | undefined, columnNames: string[]): number | undefined => {
  if (!column) return undefined;
  if (typeof column.name === 'string') {
    const nameIndex = columnNames.indexOf(column.name);
    if (nameIndex >= 0) return nameIndex;
  }
  return typeof column.index === 'number' &&
    Number.isInteger(column.index) &&
    column.index >= 0 &&
    column.index < columnNames.length
    ? column.index
    : undefined;
};

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getNestedRecord = (record: GraphConfigRecord, ...path: string[]): GraphConfigRecord => {
  let current = record;
  for (const part of path) {
    const next = current[part];
    if (!isRecord(next)) return {};
    current = next;
  }
  return current;
};

const getSeriesColumns = (
  tableData: TableData,
  graph: GraphConfigRecord,
  keyIndex: number,
  groupIndex?: number
): number[] => {
  const configured = getColumnConfigs(graph, 'values')
    .map(column => resolveColumnIndex(column, tableData.columnNames))
    .filter((index): index is number => index !== undefined);
  if (configured.length > 0) return Array.from(new Set(configured));

  return tableData.columnNames
    .map((_, index) => index)
    .filter(index => index !== keyIndex && index !== groupIndex)
    .filter(index => tableData.rows.some(row => toNumber(row[index]) !== null));
};

const buildDatasets = (
  tableData: TableData,
  graph: GraphConfigRecord,
  keyIndex: number,
  seriesColumns: number[],
  mode: Exclude<VisualizationMode, 'table'>
): { labels: string[]; datasets: ChartDataset[] } => {
  const groupIndex = resolveColumnIndex(getColumnConfigs(graph, 'groups')[0], tableData.columnNames);
  const groups =
    groupIndex === undefined
      ? [undefined]
      : Array.from(new Set(tableData.rows.map(row => row[groupIndex] || '(empty)')));
  const labels =
    groupIndex === undefined
      ? tableData.rows.map((row, index) => row[keyIndex] || `Row ${index + 1}`)
      : Array.from(new Set(tableData.rows.map((row, index) => row[keyIndex] || `Row ${index + 1}`)));

  const datasets = seriesColumns.flatMap((columnIndex, seriesIndex) =>
    groups.map((group, groupOffset) => {
      const label = group
        ? `${tableData.columnNames[columnIndex]} · ${group}`
        : tableData.columnNames[columnIndex] || `Value ${seriesIndex + 1}`;
      const color = CHART_COLORS[(seriesIndex + groupOffset) % CHART_COLORS.length];
      const rows =
        groupIndex === undefined
          ? tableData.rows
          : labels.map(labelValue =>
              tableData.rows.find(
                (row, index) =>
                  (row[keyIndex] || `Row ${index + 1}`) === labelValue && (row[groupIndex] || '(empty)') === group
              )
            );
      const values = rows.map(row => toNumber(row?.[columnIndex]));

      if (mode === 'scatterChart') {
        return {
          label,
          data: rows.map((row, index) => ({
            x: toNumber(row?.[keyIndex]) ?? index,
            y: toNumber(row?.[columnIndex])
          })),
          backgroundColor: color
        };
      }

      return {
        label,
        data: values,
        borderColor: color,
        backgroundColor:
          mode === 'pieChart'
            ? values.map((_, index) => CHART_COLORS[index % CHART_COLORS.length])
            : mode === 'lineChart' || mode === 'stackedAreaChart'
              ? `${color}33`
              : color,
        fill: mode === 'stackedAreaChart',
        tension: mode === 'lineChart' || mode === 'stackedAreaChart' ? 0.1 : undefined
      };
    })
  );

  return { labels, datasets };
};

export const createChartConfiguration = (
  tableData: TableData,
  mode: Exclude<VisualizationMode, 'table'>,
  config?: NotebookParagraphResultConfig
): ChartConfiguration | null => {
  const graph = getGraphConfig(config);
  const keyIndex = resolveColumnIndex(getColumnConfigs(graph, 'keys')[0], tableData.columnNames) ?? 0;
  const groupIndex = resolveColumnIndex(getColumnConfigs(graph, 'groups')[0], tableData.columnNames);
  const scatterSetting = getNestedRecord(graph, 'setting', 'scatterChart');
  const scatterXIndex = resolveColumnIndex(
    isRecord(scatterSetting.xAxis) ? scatterSetting.xAxis : undefined,
    tableData.columnNames
  );
  const scatterYIndex = resolveColumnIndex(
    isRecord(scatterSetting.yAxis) ? scatterSetting.yAxis : undefined,
    tableData.columnNames
  );
  const effectiveKeyIndex = mode === 'scatterChart' ? (scatterXIndex ?? keyIndex) : keyIndex;
  const seriesColumns =
    mode === 'scatterChart' && scatterYIndex !== undefined
      ? [scatterYIndex]
      : getSeriesColumns(tableData, graph, effectiveKeyIndex, groupIndex);
  if (seriesColumns.length === 0) return null;

  const { labels, datasets } = buildDatasets(tableData, graph, effectiveKeyIndex, seriesColumns, mode);
  const stacked = getNestedRecord(graph, 'setting', 'multiBarChart').stacked === true;

  return {
    type:
      mode === 'multiBarChart'
        ? 'bar'
        : mode === 'pieChart'
          ? 'pie'
          : mode === 'scatterChart'
            ? 'scatter'
            : 'line',
    data: mode === 'scatterChart' ? { datasets } : { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...(mode === 'multiBarChart' && stacked
        ? { scales: { x: { stacked: true }, y: { stacked: true } } }
        : mode === 'scatterChart'
          ? { scales: { x: { type: 'linear', position: 'bottom' } } }
          : {})
    }
  };
};

export const TableVisualization = ({
  result,
  config,
  modeChangeDisabled = false,
  onConfigChange
}: TableVisualizationProps) => {
  const configuredMode = getConfiguredMode(config);
  const [currentMode, setCurrentMode] = useState<VisualizationMode>(configuredMode);
  const chartRef = useRef<HTMLDivElement>(null);
  const themeMode = useHostThemeMode();
  const tableData = useMemo(() => parseTableData(result.data), [result.data]);
  const graph = getGraphConfig(config);
  const configuredHeight = typeof graph.height === 'number' && graph.height > 0 ? graph.height : 400;

  useEffect(() => {
    setCurrentMode(configuredMode);
  }, [configuredMode]);

  const handleExport = (type: 'csv' | 'xlsx') => {
    exportFile(tableData, type);
  };

  const changeMode = (mode: VisualizationMode): void => {
    if (modeChangeDisabled) return;
    setCurrentMode(mode);
    onConfigChange?.({ graph: { ...graph, mode } });
  };

  useEffect(() => {
    const container = chartRef.current;
    if (!container || tableData.rows.length === 0 || currentMode === 'table') return;

    const chartConfig = createChartConfiguration(tableData, currentMode, config);
    container.replaceChildren();
    if (!chartConfig) return;

    let chart: Chart | null = null;
    let cancelled = false;
    import('chart.js/auto').then(module => {
      if (cancelled) return;
      const ChartConstructor = module.Chart || module.default;
      applyChartTheme(ChartConstructor, themeMode);

      const canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);
      const context = canvas.getContext('2d');
      if (context) chart = new ChartConstructor(context, chartConfig);
    });

    return () => {
      cancelled = true;
      chart?.destroy();
      container.replaceChildren();
    };
  }, [config, currentMode, tableData, themeMode]);

  const visualization = useMemo(() => {
    if (tableData.rows.length === 0) return null;
    if (currentMode !== 'table') {
      return <div aria-label={`${currentMode} visualization`} ref={chartRef} style={{ height: configuredHeight }} />;
    }

    const columns = tableData.columnNames.map((column, index) => ({
      title: column,
      dataIndex: index,
      key: index
    }));
    const dataSource = tableData.rows.map((row, index) => ({
      key: index,
      ...Object.fromEntries(row.map((cell, cellIndex) => [cellIndex, cell]))
    }));
    return (
      <Table
        columns={columns}
        dataSource={dataSource}
        size="small"
        scroll={{ x: true }}
        pagination={{ pageSize: 50 }}
      />
    );
  }, [configuredHeight, currentMode, tableData]);

  return (
    <div>
      <VisualizationControls
        currentMode={currentMode}
        modeChangeDisabled={modeChangeDisabled}
        onModeChange={changeMode}
        onExport={handleExport}
      />
      {visualization}
    </div>
  );
};
