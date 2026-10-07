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

import styles from './NotebookParagraph.module.css';

import { useEffect, useRef, type ReactNode } from 'react';
import {
  FullscreenExitOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { ParagraphDiff } from './ParagraphDiff';
import { ApprovalActions } from '@/features/assistant-approval';
import type { ShowcaseParagraph } from './useScenario';

// A static look-alike of the New UI paragraph (paragraph.component, control, code-editor, footer) so the
// showcase reads as the real notebook. It is not the Angular component and has no behaviour.

const KEYWORDS = new Set(
  'val var def import from as print SELECT FROM WHERE GROUP BY ORDER AS sum true false null'.split(' ')
);

// Just enough highlighting to read like Monaco's light theme: keywords, strings, numbers, the %interpreter.
const highlight = (code: string): ReactNode[] =>
  code.split('\n').flatMap((line, lineIndex) => {
    const parts: ReactNode[] = lineIndex ? ['\n'] : [];
    if (line.startsWith('%'))
      return [
        ...parts,
        <span key={lineIndex} className={styles['tok-magic']}>
          {line}
        </span>
      ];
    line.split(/("[^"]*"|'[^']*'|\b\d+\b|\b[A-Za-z_]+\b)/).forEach((token, index) => {
      const key = `${lineIndex}-${index}`;
      if (/^["']/.test(token))
        parts.push(
          <span key={key} className={styles['tok-string']}>
            {token}
          </span>
        );
      else if (/^\d+$/.test(token))
        parts.push(
          <span key={key} className={styles['tok-number']}>
            {token}
          </span>
        );
      else if (KEYWORDS.has(token))
        parts.push(
          <span key={key} className={styles['tok-keyword']}>
            {token}
          </span>
        );
      else if (token) parts.push(token);
    });
    return parts;
  });

export interface NotebookParagraphProps {
  paragraph: ShowcaseParagraph;
  canDecide: boolean;
  onDecide: (decision: 'allow' | 'skip') => void;
}

export const NotebookParagraph = ({ paragraph, canDecide, onDecide }: NotebookParagraphProps) => {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (paragraph.highlight) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [paragraph.highlight]);
  // Zeppelin marks an edited, not yet run paragraph with an orange editor bar.
  const dirty = paragraph.diff?.state === 'allowed' && paragraph.status !== 'FINISHED';
  return (
    <article
      ref={ref}
      className={paragraph.highlight ? `${styles['paragraph']} ${styles['paragraph-reveal']}` : styles['paragraph']}
      data-paragraph-id={paragraph.id}
    >
      <div className={styles['paragraph-title']}>{paragraph.title}</div>
      <div className={styles['paragraph-control']}>
        <span className={styles['paragraph-status']}>{paragraph.status}</span>
        {paragraph.status === 'RUNNING' ? (
          <LoadingOutlined className={styles['control-run']} aria-hidden="true" />
        ) : (
          <PlayCircleOutlined className={styles['control-run']} aria-hidden="true" />
        )}
        <FullscreenExitOutlined aria-hidden="true" />
        <ReadOutlined aria-hidden="true" />
        <SettingOutlined aria-hidden="true" />
      </div>
      {paragraph.diff && paragraph.diff.state === 'pending' ? (
        <div className={styles['paragraph-suggestion']}>
          <ParagraphDiff
            before={paragraph.diff.before}
            after={paragraph.diff.after}
            state={paragraph.diff.state}
            actions={
              canDecide ? (
                <ApprovalActions onAllow={() => onDecide('allow')} onSkip={() => onDecide('skip')} />
              ) : undefined
            }
          />
        </div>
      ) : null}
      <pre
        className={[
          styles['editor'],
          paragraph.highlight ? styles['editor-focused'] : '',
          dirty ? styles['editor-dirty'] : '',
          paragraph.diff?.state === 'pending' ? styles['editor-muted'] : ''
        ].join(' ')}
      >
        <code>{highlight(paragraph.code)}</code>
      </pre>
      {paragraph.status === 'RUNNING' ? <div className={styles['progress']} /> : null}
      {paragraph.output ? (
        <pre key={paragraph.output} className={styles['result']}>
          {paragraph.output}
        </pre>
      ) : null}
      {paragraph.footer ? <div className={styles['footer']}>{paragraph.footer}</div> : null}
    </article>
  );
};
