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

const DEFAULT_COLOR = '#03578c';
const COLOR_PLATE_8 = ['#03578c', '#179bd4', '#bf4f07', '#005041', '#8543E0', '#57c2e9', '#03138c', '#8c0357'];

const COLOR_PLATE_16 = [
  '#03588C',
  '#82B8D9',
  '#025959',
  '#FACC14',
  '#E6965C',
  '#223273',
  '#7564CC',
  '#8543E0',
  '#5C8EE6',
  '#13C2C2',
  '#5CA3E6',
  '#3436C7',
  '#B381E6',
  '#F04864',
  '#D598D9'
];
const zeppelinTheme = {
  category10: COLOR_PLATE_8,
  category20: COLOR_PLATE_16,
  interval: { rect: { fill: DEFAULT_COLOR } },
  area: { area: { fill: DEFAULT_COLOR } },
  line: { line: { stroke: DEFAULT_COLOR } },
  point: { point: { fill: DEFAULT_COLOR }, hollowPoint: { stroke: DEFAULT_COLOR } }
};

export function setTheme() {
  register('theme.zeppelin', () => zeppelinTheme);
}
import { register } from '@antv/g2';
