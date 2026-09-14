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

import { HTMLRenderer } from '@/components/renderers/HTMLRenderer';
import { ImageRenderer } from '@/components/renderers/ImageRenderer';
import { TextRenderer } from '@/components/renderers/TextRenderer';
import { TableVisualization } from '@/components/visualizations/TableVisualization';
import { checkAndReplaceCarriageReturn } from '@/utils';
import type {
  NotebookParagraphResult,
  NotebookParagraphResultConfig,
  NotebookParagraphResultConfigs
} from '@zeppelin/notebook-core';
import { useEffect, useRef } from 'react';

interface SingleResultRendererProps {
  result: NotebookParagraphResult;
  index: number;
  config?: NotebookParagraphResultConfigs;
  modeChangeDisabled?: boolean;
  onConfigChange?: (config: NotebookParagraphResultConfig) => void;
  paragraphId?: string;
  onHostResultMount?: (
    host: unknown,
    paragraphId: string,
    resultIndex: number,
    result: NotebookParagraphResult,
    config?: NotebookParagraphResultConfig
  ) => () => void;
}

const isStructurallyEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isStructurallyEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every(
      key =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) && isStructurallyEqual(leftRecord[key], rightRecord[key])
    )
  );
};

const useStructurallyStableValue = <T,>(value: T): T => {
  const stableValue = useRef(value);
  if (!isStructurallyEqual(stableValue.current, value)) stableValue.current = value;
  return stableValue.current;
};

const HostResult = ({
  paragraphId,
  index,
  result,
  config,
  mount
}: Readonly<{
  paragraphId: string;
  index: number;
  result: NotebookParagraphResult;
  config?: NotebookParagraphResultConfig;
  mount: NonNullable<SingleResultRendererProps['onHostResultMount']>;
}>) => {
  const container = useRef<HTMLDivElement>(null);
  const mountRef = useRef(mount);
  const stableResult = useStructurallyStableValue(result);
  const stableConfig = useStructurallyStableValue(config);
  useEffect(() => {
    mountRef.current = mount;
  }, [mount]);
  useEffect(() => {
    if (!container.current) return;
    const host = document.createElement('div');
    container.current.replaceChildren(host);
    const unmount = mountRef.current(host, paragraphId, index, stableResult, stableConfig);
    return () => {
      unmount();
      host.remove();
    };
  }, [index, paragraphId, stableConfig, stableResult]);
  return <div aria-label="Host result" ref={container} />;
};

export const SingleResultRenderer = ({
  result,
  index,
  config,
  modeChangeDisabled,
  onConfigChange,
  paragraphId,
  onHostResultMount
}: SingleResultRendererProps) => {
  const resultConfig = config?.[index];

  switch (result.type) {
    case 'TABLE':
      return paragraphId && onHostResultMount ? (
        <HostResult
          paragraphId={paragraphId}
          index={index}
          result={result}
          config={resultConfig}
          mount={onHostResultMount}
        />
      ) : (
        <TableVisualization
          result={result}
          config={resultConfig}
          modeChangeDisabled={modeChangeDisabled}
          onConfigChange={onConfigChange}
        />
      );
    case 'HTML':
      return <HTMLRenderer html={result.data} />;
    case 'TEXT':
      return <TextRenderer text={checkAndReplaceCarriageReturn(result.data)} />;
    case 'IMG':
      return <ImageRenderer imageData={result.data} />;
    case 'ANGULAR':
      return paragraphId && onHostResultMount ? (
        <HostResult
          paragraphId={paragraphId}
          index={index}
          result={result}
          config={resultConfig}
          mount={onHostResultMount}
        />
      ) : (
        <div role="alert">Angular output requires the Angular notebook host.</div>
      );
    default:
      return null;
  }
};
