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

import styles from './ParagraphDiff.module.css';
import styleAssistantScope from '../../../shared/ui/assistant-theme/AssistantScope.module.css';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { CaretRightOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { AiMark } from '@/entities/assistant';
import { diffLines } from './lineDiff';
import type { ApprovalState } from '@/features/assistant-approval';

export interface ParagraphDiffProps {
  before: string;
  after: string;
  state: ApprovalState;
  /**
   * The decision controls, normally `<ApprovalActions>` for the same approval the panel shows, so answering
   * here or there answers both. Omit when this user cannot decide.
   */
  actions?: ReactNode;
  /** Offered after the edit is applied; running is its own tool call and asks separately. */
  onRun?: () => void;
}

const SIGN = { same: ' ', removed: '-', added: '+' } as const;

/**
 * A proposed edit shown inside the paragraph it changes, above the editor, the way Databricks puts
 * suggestions in the cell. The panel keeps the record; the decision is made where the code is.
 *
 * A showcase stand-in only: in the notebook the diff belongs to the Angular paragraph, drawn by the notebook's
 * Monaco diff editor (`zeppelin-code-editor` diff mode).
 */
export const ParagraphDiff = ({ before, after, state, actions, onRun }: ParagraphDiffProps) => {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const added = lines.filter(line => line.kind === 'added').length;
  const removed = lines.filter(line => line.kind === 'removed').length;
  return (
    <section className={styles['paragraph-diff']} data-state={state} aria-label="Suggested change from the assistant">
      <header className={styles['paragraph-diff-bar']}>
        <AiMark active={state === 'pending'} />
        <span className={styles['paragraph-diff-title']}>
          {state === 'allowed' ? 'Change applied' : state === 'pending' ? 'Suggested change' : 'Change skipped'}
        </span>
        <span className={styles['paragraph-diff-count']}>
          <span className={styles['diff-added-count']}>+{added}</span>{' '}
          <span className={styles['diff-removed-count']}>−{removed}</span>
        </span>
        <span className={styles['paragraph-diff-actions']}>
          {state === 'pending' ? actions : null}
          {state === 'allowed' && onRun ? (
            <Button size="small" icon={<CaretRightOutlined />} onClick={onRun}>
              Run
            </Button>
          ) : null}
        </span>
      </header>
      {state === 'pending' ? (
        <div className={styles['diff']} role="table" aria-label={`${added} lines added, ${removed} lines removed`}>
          {lines.map((line, index) => (
            <div
              key={index}
              role="row"
              className={styles['diff-line']}
              data-kind={line.kind}
              style={{ '--za-line-index': index } as CSSProperties}
            >
              <span role="cell" className={styles['diff-number']}>
                {line.kind === 'added' ? '' : line.before}
              </span>
              <span role="cell" className={styles['diff-number']}>
                {line.kind === 'removed' ? '' : line.after}
              </span>
              <span role="cell" className={styles['diff-text']}>
                <span aria-hidden="true" className={styles['diff-sign']}>
                  {SIGN[line.kind]}
                </span>
                <span className={styleAssistantScope['visually-hidden']}>
                  {line.kind === 'same' ? '' : `${line.kind}: `}
                </span>
                {line.text || ' '}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};
