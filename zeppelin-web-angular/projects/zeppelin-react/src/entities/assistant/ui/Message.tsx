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

import styleAssistantScope from '../../../shared/ui/assistant-theme/AssistantScope.module.css';
import styles from './Message.module.css';

import type { ReactNode } from 'react';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useCopy } from '../../../shared/lib/useCopy';

/** The assistant's identity: a small "AI" tag in the sidebar mark's iridescent wash, never a person. */
export const AiMark = ({ active = false }: { active?: boolean }) => (
  <span className={active ? `${styles['ai-mark']} ${styles['ai-mark-active']}` : styles['ai-mark']} aria-hidden="true">
    AI
  </span>
);

// Loaded history is already there; only messages of this session rise in.
const messageClass = (role: 'user' | 'assistant', fromHistory: boolean) =>
  `${styles['message']} ${styles[`message-${role}`]}${fromHistory ? ` ${styles['message-settled']}` : ''}`;

/** What the user typed, kept verbatim in a compact shaded block on the right. */
export const UserMessage = ({ children, fromHistory = false }: { children: ReactNode; fromHistory?: boolean }) => (
  <article className={messageClass('user', fromHistory)} data-role="user">
    <div className={`${styles['message-sender']} ${styleAssistantScope['visually-hidden']}`}>You</div>
    <div className={styles['user-text']}>{children}</div>
  </article>
);

export interface AssistantReplyProps {
  children: ReactNode;
  /** Tokens are still arriving: the mark animates, the only place the wash moves. */
  streaming?: boolean;
  /** Plain text of the answer for Copy; omitted while streaming so a half answer is not copied. */
  copyText?: string;
  /** Loaded from history, so it appears without the arrival motion. */
  fromHistory?: boolean;
}

/** An answer: flat and full width so code and tables get the whole panel, attributed by the AI mark. */
export const AssistantReply = ({ children, streaming = false, copyText, fromHistory = false }: AssistantReplyProps) => {
  const { state: copied, copy } = useCopy();
  return (
    <article
      className={messageClass('assistant', fromHistory)}
      data-role="assistant"
      aria-busy={streaming || undefined}
    >
      <header className={styles['message-sender']}>
        <AiMark active={streaming} />
        {/* The mark says who wrote it; the name is for screen readers. */}
        <span className={styleAssistantScope['visually-hidden']}>Assistant</span>
      </header>
      <div className={styles['assistant-body']}>{children}</div>
      {copyText && !streaming ? (
        <div className={styles['message-actions']}>
          <Button
            size="small"
            type="text"
            icon={copied === 'done' ? <CheckOutlined /> : <CopyOutlined />}
            aria-label="Copy answer"
            title="Copy answer"
            onClick={() => void copy(copyText)}
          />
          {/* Mounted always, so each outcome is announced; only a failure needs to be seen. */}
          <small role="status" className={copied === 'failed' ? undefined : styleAssistantScope['visually-hidden']}>
            {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed. Select the text to copy it.' : ''}
          </small>
        </div>
      ) : null}
    </article>
  );
};

/** Once per conversation, under the latest answer (GitLab: "once per context"). */
export const AiDisclaimer = () => (
  <p className={styles['disclaimer']}>AI answers can be wrong. Check them before you rely on them.</p>
);
