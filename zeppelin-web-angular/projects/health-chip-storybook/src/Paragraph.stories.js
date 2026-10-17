/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { card, HEALTH, INTERPRETERS, STATUS } from './card.js';

export default {
  title: 'Health chip/Paragraph (bottom right)',
  parameters: {
    docs: {
      description: {
        component:
          'Static HTML/CSS replica of a Zeppelin paragraph card. The chip sits at the bottom right inside the footer row and writes only a problem; its tooltip follows the WAI-ARIA tooltip pattern (hover or focus, Escape closes, never takes focus).'
      }
    }
  },
  argTypes: {
    interpreter: { control: 'select', options: INTERPRETERS },
    health: { control: 'select', options: HEALTH },
    status: { control: 'select', options: STATUS },
    output: { control: 'select', options: ['text', 'table', 'none'] },
    widthCols: { control: 'select', options: [12, 6, 4, 3, 2] }
  }
};

export const Default = {
  args: {
    interpreter: 'python',
    health: 'healthy',
    status: 'FINISHED',
    output: 'text',
    widthCols: 12
  },
  render: args => card(args)
};

export const Unhealthy = {
  args: { ...Default.args, health: 'unhealthy', interpreter: 'spark' },
  render: Default.render
};

export const AllStatuses = {
  render: () =>
    STATUS.map(
      s => `<div class="cap">${s}</div>${card({ status: s, health: s === 'ERROR' ? 'unhealthy' : 'healthy' })}`
    ).join('')
};

export const Widths = {
  render: () =>
    [12, 6, 4, 3, 2]
      .map(
        w =>
          `<div class="cap">${w} columns</div><div class="row" style="margin:0 0 12px">${card({ widthCols: w, output: 'table' })}</div>`
      )
      .join('')
};

export const HealthStates = {
  render: () => HEALTH.map(h => `<div class="cap">${h}</div>${card({ health: h, widthCols: 6 })}`).join('')
};
