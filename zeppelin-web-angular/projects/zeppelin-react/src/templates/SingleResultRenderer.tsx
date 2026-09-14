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

import { Alert } from 'antd';
import { HTMLRenderer } from '@/components/renderers/HTMLRenderer';
import { ImageRenderer } from '@/components/renderers/ImageRenderer';
import { TextRenderer } from '@/components/renderers/TextRenderer';
import { TableVisualization } from '@/components/visualizations/TableVisualization';
import { checkAndReplaceCarriageReturn } from '@/utils';

export type ResultRendererMode =
  | 'table'
  | 'multiBarChart'
  | 'pieChart'
  | 'lineChart'
  | 'stackedAreaChart'
  | 'scatterChart'
  | string;

export type ResultRendererResult = Readonly<{
  type: string;
  data: string;
}>;

export type ResultRendererConfig = Readonly<{
  graph: Readonly<{ mode?: ResultRendererMode; [key: string]: unknown }>;
}>;

export type ResultRendererConfigs = Readonly<Record<string, ResultRendererConfig>>;

interface SingleResultRendererProps {
  result: ResultRendererResult;
  index: number;
  config?: ResultRendererConfigs;
  modeChangeDisabled?: boolean;
  onConfigChange?: (config: ResultRendererConfig) => void;
}

const DatasetType = {
  TABLE: 'TABLE',
  HTML: 'HTML',
  TEXT: 'TEXT',
  IMG: 'IMG',
  ANGULAR: 'ANGULAR'
} as const;

export const SingleResultRenderer = ({
  result,
  index,
  config,
  modeChangeDisabled,
  onConfigChange
}: SingleResultRendererProps) => {
  const resultConfig = config?.[index];

  switch (result.type) {
    case DatasetType.TABLE:
      return (
        <TableVisualization
          result={result}
          config={resultConfig}
          modeChangeDisabled={modeChangeDisabled}
          onConfigChange={onConfigChange}
        />
      );
    case DatasetType.HTML:
      return <HTMLRenderer html={result.data} />;
    case DatasetType.TEXT:
      return <TextRenderer text={checkAndReplaceCarriageReturn(result.data)} />;
    case DatasetType.IMG:
      return <ImageRenderer imageData={result.data} />;
    case DatasetType.ANGULAR:
      return (
        <Alert
          message="Angular Component"
          description="Angular components are not supported in React environment"
          type="warning"
          showIcon
        />
      );
    default:
      return null;
  }
};
