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

import styles from './ActionLog.module.css';

import { useEffect, useState, type ReactNode } from 'react';
import { CheckOutlined, MinusCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { Spin } from 'antd';

/**
 * Where one tool call stands. `awaiting` and `skipped` belong to tools that change the notebook:
 * the server holds them until the user answers an approval. The server has no tool failure event, so
 * there is no failed state; a failed run is reported by the panel's error notice.
 */
export type ToolStepStatus = 'running' | 'done' | 'awaiting' | 'skipped';

export interface ToolStep {
  id: string;
  /** What the tool did, in the user's words ("Read paragraphs"). */
  label: string;
  status: ToolStepStatus;
}

// The panel's progress line is the live region; step icons stay silent apart from their names.
const StatusIcon = ({ status }: { status: ToolStepStatus }) => {
  switch (status) {
    case 'done':
      return <CheckOutlined className={`${styles['step-icon']} ${styles['step-done']}`} aria-label="Done" />;
    case 'awaiting':
      return (
        <PauseCircleOutlined
          className={`${styles['step-icon']} ${styles['step-awaiting']}`}
          aria-label="Waiting for approval"
        />
      );
    case 'skipped':
      return (
        <MinusCircleOutlined className={`${styles['step-icon']} ${styles['step-skipped']}`} aria-label="Skipped" />
      );
    default:
      return (
        <span role="img" aria-label="In progress" className={styles['step-icon']}>
          <span aria-hidden="true">
            <Spin size="small" />
          </span>
        </span>
      );
  }
};

export interface ActionLogProps {
  steps: ToolStep[];
  /** The run is still working: the log stays open so progress is visible. */
  running: boolean;
  /** Approvals and the like, shown inside the log under the steps. */
  children?: ReactNode;
}

/**
 * One run's tool calls as a single disclosure: open while the run works or needs approval,
 * folded afterwards so the answer stays in front.
 */
export const ActionLog = ({ steps, running, children }: ActionLogProps) => {
  const needsAttention = steps.some(step => step.status === 'awaiting');
  const [open, setOpen] = useState(running || needsAttention);
  useEffect(() => setOpen(running || needsAttention), [running, needsAttention]);
  return (
    <details
      className={needsAttention ? `${styles['actions']} ${styles['actions-attention']}` : styles['actions']}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={`Assistant actions, ${steps.length}`}>
        <span>
          {steps.length} {steps.length === 1 ? 'action' : 'actions'}
        </span>
      </summary>
      <ul>
        {steps.map(step => (
          <li key={step.id} className={styles['step']} data-status={step.status}>
            <StatusIcon key={step.status} status={step.status} />
            <span className={styles['step-label']}>{step.label}</span>
          </li>
        ))}
      </ul>
      {children}
    </details>
  );
};
