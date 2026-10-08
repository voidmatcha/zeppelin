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
import { HTMLRenderer, TextRenderer, ImageRenderer, TableVisualization } from '@/components';
import { checkAndReplaceCarriageReturn } from '@/utils';
import type { ResultConfig, ResultConfigs, ResultMessage } from '@/components/visualizations/result-types';

interface SingleResultRendererProps {
  result: ResultMessage;
  index: number;
  config?: ResultConfigs;
  readOnly?: boolean;
  visualKey?: string;
  onVisualReady?: (key: string) => void;
  onVisualError?: (error: unknown) => void;
}

export const SingleResultRenderer = ({
  result,
  index,
  config,
  readOnly = false,
  visualKey,
  onVisualReady,
  onVisualError
}: SingleResultRendererProps) => {
  const resultConfig: ResultConfig | undefined = config?.[index];

  switch (result.type) {
    case 'TABLE':
      return (
        <TableVisualization
          result={result}
          config={resultConfig}
          readOnly={readOnly}
          visualKey={visualKey}
          onVisualReady={onVisualReady}
          onVisualError={onVisualError}
        />
      );
    case 'HTML':
      return <HTMLRenderer html={result.data} />;
    case 'TEXT':
      return <TextRenderer text={checkAndReplaceCarriageReturn(result.data)} />;
    case 'IMG':
      return <ImageRenderer imageData={result.data} />;
    case 'SVG':
      return <ImageRenderer imageData={result.data} format="svg" />;
    case 'ANGULAR':
      return (
        <Alert
          message="Angular Component"
          description="Angular components are not supported in React environment"
          type="warning"
          showIcon
        />
      );
    case 'NULL':
    case 'NETWORK':
      return null;
    default: {
      const _unhandled: never = result.type;
      return null;
    }
  }
};
