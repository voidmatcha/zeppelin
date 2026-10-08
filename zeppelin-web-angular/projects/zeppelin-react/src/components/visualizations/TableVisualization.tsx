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

import { useState, useEffect, useMemo, useRef } from 'react';
import { Table } from 'antd';
import { VisualizationControls } from './VisualizationControls';
import { readOnlyChartData } from './readOnlyChartData';
import { applyChartTheme, useHostThemeMode } from '@/theme';
import { parseTableData, exportFile } from '@/utils';
import type { ResultConfig, ResultMessage } from './result-types';
import type { Chart, ChartConfiguration } from 'chart.js';

interface TableVisualizationProps {
  result: ResultMessage;
  config?: ResultConfig;
  readOnly?: boolean;
  visualKey?: string;
  onVisualReady?: (key: string) => void;
  onVisualError?: (error: unknown) => void;
}

const savedChartModes = new Set(['multiBarChart', 'lineChart', 'stackedAreaChart', 'pieChart', 'scatterChart']);

export const TableVisualization = ({
  result,
  config,
  readOnly = false,
  visualKey,
  onVisualReady,
  onVisualError
}: TableVisualizationProps) => {
  const [currentMode, setCurrentMode] = useState<string>(config?.graph?.mode || 'table');
  const savedMode = config?.graph?.mode;
  const readOnlyMode = savedMode && savedChartModes.has(savedMode) ? savedMode : 'table';
  const unsupportedAreaStyle =
    readOnly &&
    readOnlyMode === 'stackedAreaChart' &&
    ['stream', 'expand'].includes(config?.graph?.setting?.stackedAreaChart?.style ?? 'stack');
  const displayMode = readOnly ? (unsupportedAreaStyle ? 'table' : readOnlyMode) : currentMode;
  const chartRef = useRef<HTMLDivElement>(null);
  const themeMode = useHostThemeMode();

  const tableData = useMemo(() => parseTableData(result.data), [result.data]);
  const readOnlyData = useMemo(
    () => (readOnly && tableData && config?.graph ? readOnlyChartData(tableData, config.graph) : null),
    [readOnly, tableData, config?.graph]
  );

  const handleExport = (type: 'csv' | 'xlsx') => {
    if (tableData) {
      exportFile(tableData, type);
    }
  };

  const renderVisualization = () => {
    if (!tableData || tableData.rows.length === 0) return null;

    if (displayMode === 'table') {
      const columns = tableData.columnNames.map((col, idx) => ({
        title: col,
        dataIndex: idx,
        key: idx,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render: (text: any) => text
      }));

      const dataSource = tableData.rows.map((row, idx) => ({
        key: idx,
        ...row.reduce((acc, cell, cellIdx) => ({ ...acc, [cellIdx]: cell }), {})
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
    }

    return <div ref={chartRef} style={{ height: 400 }}></div>;
  };

  useEffect(() => {
    const container = chartRef.current;
    if (!container || !tableData || tableData.rows.length === 0 || displayMode === 'table') {
      if (readOnly && visualKey) onVisualReady?.(visualKey);
      return;
    }

    const data = tableData.rows.map((row, idx) => ({
      category: row[0] || `Row ${idx + 1}`,
      value: parseFloat(row[1] || '0') || 0,
      x: idx,
      y: parseFloat(row[1] || '0') || 0
    }));

    container.innerHTML = '';

    let chart: Chart | null = null;
    let cancelled = false;

    import('chart.js/auto')
      .then(module => {
        if (cancelled || !container) return;

        const ChartConstructor = module.Chart || module.default;

        // Ticks, legend labels and grid lines all resolve from these two
        // globals, and a canvas is out of reach of the shell's stylesheets.
        applyChartTheme(ChartConstructor, themeMode);

        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${displayMode} visualization`);
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable for the saved chart');

        let chartConfig: ChartConfiguration | null = null;
        if (readOnly && readOnlyData) {
          const mapped = readOnlyData;
          const colors = ['#1890ff', '#2fc25b', '#facc14', '#8543e0', '#13c2c2', '#f04864'];
          const sharedOptions = { responsive: true, maintainAspectRatio: false };
          if (displayMode === 'scatterChart') {
            chartConfig = {
              type: 'scatter',
              data: {
                datasets: mapped.scatter.map((series, index) => ({
                  label: series.label,
                  data: series.points.map(point => ({ x: point.x, y: point.y })),
                  pointRadius: series.points.map(point => point.radius),
                  backgroundColor: colors[index % colors.length]
                }))
              },
              options: sharedOptions
            };
          } else if (['multiBarChart', 'lineChart', 'stackedAreaChart', 'pieChart'].includes(displayMode)) {
            const type = displayMode === 'multiBarChart' ? 'bar' : displayMode === 'pieChart' ? 'pie' : 'line';
            chartConfig = {
              type,
              data: {
                labels: mapped.labels,
                datasets: mapped.series.map((series, index) => ({
                  label: series.label,
                  data: series.values,
                  borderColor: colors[index % colors.length],
                  backgroundColor: displayMode === 'pieChart' ? colors : colors[index % colors.length],
                  fill: displayMode === 'stackedAreaChart' ? 'stack' : false
                }))
              },
              options:
                displayMode === 'stackedAreaChart'
                  ? { ...sharedOptions, scales: { y: { stacked: true } } }
                  : sharedOptions
            };
          }
        } else
          switch (currentMode) {
            case 'multiBarChart':
              chartConfig = {
                type: 'bar',
                data: {
                  labels: data.map(d => d.category),
                  datasets: [
                    {
                      label: 'Value',
                      data: data.map(d => d.value),
                      backgroundColor: '#1890ff'
                    }
                  ]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false
                }
              };
              break;
            case 'lineChart':
              chartConfig = {
                type: 'line',
                data: {
                  labels: data.map(d => d.category),
                  datasets: [
                    {
                      label: 'Value',
                      data: data.map(d => d.value),
                      borderColor: '#1890ff',
                      backgroundColor: 'rgba(24, 144, 255, 0.1)',
                      tension: 0.1
                    }
                  ]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false
                }
              };
              break;
            case 'pieChart':
              chartConfig = {
                type: 'pie',
                data: {
                  labels: data.map(d => d.category),
                  datasets: [
                    {
                      data: data.map(d => d.value),
                      backgroundColor: [
                        '#1890ff',
                        '#2fc25b',
                        '#facc14',
                        '#223273',
                        '#8543e0',
                        '#13c2c2',
                        '#3436c7',
                        '#f04864'
                      ]
                    }
                  ]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false
                }
              };
              break;
            case 'scatterChart':
              chartConfig = {
                type: 'scatter',
                data: {
                  datasets: [
                    {
                      label: 'Value',
                      data: data.map(d => ({ x: d.x, y: d.y })),
                      backgroundColor: '#1890ff'
                    }
                  ]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: { type: 'linear', position: 'bottom' }
                  }
                }
              };
              break;
            case 'stackedAreaChart':
              chartConfig = {
                type: 'line',
                data: {
                  labels: data.map(d => d.category),
                  datasets: [
                    {
                      label: 'Value',
                      data: data.map(d => d.value),
                      borderColor: '#1890ff',
                      backgroundColor: 'rgba(24, 144, 255, 0.2)',
                      fill: true,
                      tension: 0.1
                    }
                  ]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false
                }
              };
              break;
          }

        if (!chartConfig) throw new Error(`Unsupported saved chart mode: ${displayMode}`);
        chart = new ChartConstructor(ctx, chartConfig);
        if (!cancelled && visualKey) onVisualReady?.(visualKey);
      })
      .catch(error => {
        if (!cancelled) onVisualError?.(error);
      });

    return () => {
      cancelled = true;
      if (chart) {
        chart.destroy();
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [currentMode, displayMode, onVisualError, onVisualReady, readOnly, readOnlyData, tableData, themeMode, visualKey]);

  return (
    <div>
      {!readOnly && (
        <VisualizationControls currentMode={currentMode} onModeChange={setCurrentMode} onExport={handleExport} />
      )}
      {unsupportedAreaStyle && <p role="status">This saved area style is not available in the read-only preview.</p>}
      {renderVisualization()}
      {readOnly && displayMode !== 'table' && readOnlyData && (
        <details>
          <summary>View chart data as a table</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{displayMode === 'scatterChart' ? 'Group' : 'Category'}</th>
                {displayMode === 'scatterChart' ? (
                  <>
                    <th scope="col">X</th>
                    <th scope="col">Y</th>
                    <th scope="col">Size</th>
                  </>
                ) : (
                  readOnlyData.series.map(series => (
                    <th scope="col" key={series.label}>
                      {series.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {displayMode === 'scatterChart'
                ? readOnlyData.scatter.flatMap(series =>
                    series.points.map((point, index) => (
                      <tr key={`${series.label}-${index}`}>
                        <th scope="row">{series.label}</th>
                        <td>{point.x}</td>
                        <td>{point.y}</td>
                        <td>{point.radius}</td>
                      </tr>
                    ))
                  )
                : readOnlyData.labels.map((label, index) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {readOnlyData.series.map(series => (
                        <td key={series.label}>{series.values[index]}</td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
};
