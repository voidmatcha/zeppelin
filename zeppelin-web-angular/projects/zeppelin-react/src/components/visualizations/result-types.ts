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

export type ResultType = 'NETWORK' | 'TABLE' | 'HTML' | 'TEXT' | 'ANGULAR' | 'IMG' | 'SVG' | 'NULL';
export type ResultMessage = Readonly<{ type: ResultType; data: string }>;

export type SavedGraphConfig = Readonly<{
  mode: string;
  keys?: readonly Readonly<{ name: string }>[];
  groups?: readonly Readonly<{ name: string }>[];
  values?: readonly Readonly<{ name: string; aggr: string }>[];
  setting?: Readonly<{
    multiBarChart?: Readonly<{ stacked?: boolean }>;
    stackedAreaChart?: Readonly<{ style?: string }>;
    scatterChart?: Readonly<{
      xAxis?: Readonly<{ name: string }>;
      yAxis?: Readonly<{ name: string }>;
      group?: Readonly<{ name: string }>;
      size?: Readonly<{ name: string }>;
    }>;
  }>;
}>;

export type ResultConfig = Readonly<{ graph: SavedGraphConfig }>;
export type ResultConfigs = Readonly<Record<string, ResultConfig>>;
