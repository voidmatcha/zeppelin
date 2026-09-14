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

import type { NotebookParagraphResultConfig } from '@zeppelin/notebook-core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChartConfiguration, TableVisualization } from './TableVisualization';

vi.mock('chart.js/auto', () => ({
  Chart: vi.fn()
}));

const TABLE_DATA = {
  columnNames: ['region', 'sales', 'cost', 'comment'],
  rows: [
    ['east', '10', '4', 'ok'],
    ['west', '20', '7', 'good']
  ]
};

describe('createChartConfiguration', () => {
  it('uses configured key and value columns in their configured order', () => {
    const config = {
      graph: {
        keys: [{ name: 'region', index: 0, aggr: 'sum' }],
        values: [
          { name: 'cost', index: 2, aggr: 'sum' },
          { name: 'sales', index: 1, aggr: 'sum' }
        ]
      }
    } as unknown as NotebookParagraphResultConfig;

    const chart = createChartConfiguration(TABLE_DATA, 'lineChart', config);

    expect(chart?.data.labels).toEqual(['east', 'west']);
    expect(chart?.data.datasets.map(dataset => dataset.label)).toEqual(['cost', 'sales']);
    expect(chart?.data.datasets.map(dataset => dataset.data)).toEqual([
      [4, 7],
      [10, 20]
    ]);
  });

  it('falls back to every numeric column after the category column', () => {
    const chart = createChartConfiguration(TABLE_DATA, 'multiBarChart');

    expect(chart?.data.datasets.map(dataset => dataset.label)).toEqual(['sales', 'cost']);
    expect(chart?.data.datasets.map(dataset => dataset.data)).toEqual([
      [10, 20],
      [4, 7]
    ]);
  });

  it('uses configured scatter axes and ignores unrelated numeric columns', () => {
    const config = {
      graph: {
        setting: {
          scatterChart: {
            xAxis: { name: 'cost', index: 2 },
            yAxis: { name: 'sales', index: 1 }
          }
        }
      }
    } as unknown as NotebookParagraphResultConfig;

    const chart = createChartConfiguration(TABLE_DATA, 'scatterChart', config);

    expect(chart?.data.datasets).toHaveLength(1);
    expect(chart?.data.datasets[0].label).toBe('sales');
    expect(chart?.data.datasets[0].data).toEqual([
      { x: 4, y: 10 },
      { x: 7, y: 20 }
    ]);
  });
});

describe('TableVisualization', () => {
  it('persists a mode change without discarding the existing graph config', () => {
    const onConfigChange = vi.fn();
    const config = {
      graph: {
        mode: 'table',
        height: 280,
        keys: [{ name: 'region', index: 0, aggr: 'sum' }]
      }
    } as unknown as NotebookParagraphResultConfig;
    render(
      <TableVisualization
        result={{ type: 'TABLE', data: 'region\tsales\neast\t10' }}
        config={config}
        onConfigChange={onConfigChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Line Chart/ }));

    expect(onConfigChange).toHaveBeenCalledWith({
      graph: {
        mode: 'lineChart',
        height: 280,
        keys: [{ name: 'region', index: 0, aggr: 'sum' }]
      }
    });
    expect(screen.getByLabelText('lineChart visualization').style.height).toBe('280px');
  });

  it('follows a display-mode update from persisted config', () => {
    const { rerender } = render(
      <TableVisualization
        result={{ type: 'TABLE', data: 'region\tsales\neast\t10' }}
        config={{ graph: { mode: 'table' } } as NotebookParagraphResultConfig}
      />
    );
    expect(screen.getByText('east')).toBeTruthy();

    rerender(
      <TableVisualization
        result={{ type: 'TABLE', data: 'region\tsales\neast\t10' }}
        config={{ graph: { mode: 'multiBarChart' } } as NotebookParagraphResultConfig}
      />
    );

    expect(screen.getByLabelText('multiBarChart visualization')).toBeTruthy();
    expect(screen.queryByText('east')).toBeNull();
  });
});
