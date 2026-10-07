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

import styles from './ToolApproval.module.css';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from 'antd';

/** `pending` waits for the user. Skip, a timeout and a disconnect all end as `skipped`. */
export type ApprovalState = 'pending' | 'allowed' | 'skipped';

export interface ToolApprovalProps {
  /** The action in the user's words: "Edit paragraph", "Run paragraph". */
  action: string;
  /** Which object it touches, usually a paragraph link. */
  target?: ReactNode;
  /** One or two sentences on what will change, written by the server, not the model. */
  description?: ReactNode;
  state: ApprovalState;
  /** Only the conversation owner on the connection that started the run may answer. */
  canDecide?: boolean;
  onAllow?: () => void;
  onSkip?: () => void;
  /** Where to review the change, e.g. "Review the diff in the paragraph". */
  reviewHint?: ReactNode;
}

const RESULT: Record<Exclude<ApprovalState, 'pending'>, string> = {
  allowed: 'Allowed',
  skipped: 'Skipped. The assistant was told not to do this.'
};

interface ApprovalActionsProps {
  onAllow?: () => void;
  onSkip?: () => void;
}

/** The one Allow/Skip pair, used by the panel's approval and by the diff inside the paragraph. */
export const ApprovalActions = ({ onAllow, onSkip }: ApprovalActionsProps) => (
  <>
    <Button size="small" type="primary" onClick={onAllow}>
      Allow
    </Button>
    <Button size="small" onClick={onSkip}>
      Skip
    </Button>
  </>
);

/**
 * Asks before a tool that changes the notebook runs. Nothing happens until Allow; Skip, a timeout or a
 * disconnect means the tool does not run. Allowing an edit never runs the paragraph: running asks again.
 */
export const ToolApproval = ({
  action,
  target,
  description,
  state,
  canDecide = true,
  onAllow,
  onSkip,
  reviewHint
}: ToolApprovalProps) => {
  const titleId = useId();
  // Allow and Skip leave with the answer; after an answer given here, focus goes to the result in their place.
  const answeredHere = useRef(false);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== 'pending' && answeredHere.current) {
      answeredHere.current = false;
      result.current?.focus();
    }
  }, [state]);
  const answer = (decide?: () => void) => () => {
    answeredHere.current = true;
    decide?.();
  };
  return (
    <section className={styles['approval']} data-state={state} aria-labelledby={titleId}>
      <div className={styles['approval-title']} id={titleId}>
        {state === 'pending' ? 'Approval needed: ' : null}
        <strong>{action}</strong>
        {target ? <> {target}</> : null}
      </div>
      {description ? <div className={styles['approval-description']}>{description}</div> : null}
      {state === 'pending' && reviewHint ? <div className={styles['approval-hint']}>{reviewHint}</div> : null}
      {state === 'pending' ? (
        canDecide ? (
          <div className={styles['approval-actions']}>
            <ApprovalActions onAllow={answer(onAllow)} onSkip={answer(onSkip)} />
          </div>
        ) : (
          <div className={styles['approval-hint']}>Waiting for the conversation owner to answer.</div>
        )
      ) : (
        // Announced by the panel; focusable so an answer given here does not drop keyboard focus.
        <div className={styles['approval-result']} ref={result} tabIndex={-1}>
          {RESULT[state]}
        </div>
      )}
    </section>
  );
};
