/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest';

import { Chart } from '@antv/g2';

describe('G2 5 chart API', () => {
  it('builds a stacked interval specification with encoded channels', () => {
    const rows = [
      { category: 'a', series: 'one', value: 2 },
      { category: 'a', series: 'two', value: 3 }
    ];
    const chart = new Chart({ container: document.createElement('div'), autoFit: true, height: 400, padding: 50 });

    chart.data(rows);
    chart.interval().encode({ x: 'category', y: 'value', color: 'series' }).transform({ type: 'stackY' });

    expect(chart.options()).toMatchObject({ data: rows });
    expect(chart.options().children?.[0]).toMatchObject({
      type: 'interval',
      encode: { x: 'category', y: 'value', color: 'series' },
      transform: [{ type: 'stackY' }]
    });
  });

  it('uses the theta coordinate and normalized stack for pie charts', () => {
    const chart = new Chart({ container: document.createElement('div') });

    chart
      .interval()
      .encode({ y: 'value', color: 'category' })
      .coordinate({ type: 'theta', outerRadius: 0.75 })
      .transform([{ type: 'stackY' }, { type: 'normalizeY' }]);

    expect(chart.options().children?.[0]).toMatchObject({
      coordinate: { type: 'theta', outerRadius: 0.75 },
      transform: [{ type: 'stackY' }, { type: 'normalizeY' }]
    });
  });

  it('configures line focus with the G2 v5 x-brush interaction', () => {
    const chart = new Chart({ container: document.createElement('div') });
    chart.interaction({ brushXHighlight: true });
    expect(chart.options().interaction).toMatchObject({ brushXHighlight: true });

    chart.interaction({ brushXHighlight: false });
    expect(chart.options().interaction).toMatchObject({ brushXHighlight: false });
  });
});
