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

import styles from './Showcase.module.css';

import { Fragment, type CSSProperties } from 'react';
import { CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, theme } from 'antd';
import {
  ActionLog,
  AssistantPanelLayout,
  Composer,
  ConversationHeader,
  EmptyState,
  MarkdownAnswer,
  ParagraphLink,
  type ParagraphLabel,
  AiDisclaimer,
  AssistantReply,
  UserMessage,
  RunStatus
} from '@/entities/assistant';
import { AssistantScope } from '@/shared/ui/assistant-theme';

import { ToolApproval } from '@/features/assistant-approval';
import { NotebookParagraph } from './NotebookParagraph';
import { useScenario, type ScenarioScript, type ShowcaseState } from './useScenario';

export interface ShowcaseProps {
  title: string;
  summary: string;
  beats: string[];
  initial: () => ShowcaseState;
  script: ScenarioScript;
}

/**
 * A scripted session on the real design-system pieces: the panel on the left as in Zeppelin's sidebar,
 * a mock notebook on the right. Approvals wait for the viewer.
 */
export const Showcase = ({ title, summary, beats, initial, script }: ShowcaseProps) => {
  const { state, answer, replay } = useScenario(initial, script);
  const { token } = theme.useToken();
  const labels = new Map<string, ParagraphLabel>(
    state.paragraphs.map(paragraph => [paragraph.id, { text: paragraph.title, name: paragraph.title }])
  );
  const describe = (paragraphId: string) => labels.get(paragraphId);
  const lastAssistant = [...state.messages].reverse().find(message => message.role === 'assistant');
  const approvalTarget = state.approval ? labels.get(state.approval.paragraphId) : undefined;
  return (
    <AssistantScope className={styles['root']}>
      <header className={styles['intro']}>
        <div>
          <h2>{title}</h2>
          <p>{summary}</p>
        </div>
        <div className={styles['controls']}>
          <Button size="small" icon={<ReloadOutlined aria-hidden="true" />} onClick={replay}>
            Replay
          </Button>
        </div>
      </header>
      <ol className={styles['timeline']} aria-label="Scenario">
        {beats.map((beat, index) => (
          <li key={beat} data-state={index < state.beat ? 'done' : index === state.beat ? 'current' : 'next'}>
            <span>{index + 1}</span>
            {beat}
          </li>
        ))}
      </ol>
      <div className={styles['stage']}>
        <div className={styles['panel']}>
          {/* AssistantWorkspace's panel heading */}
          <AssistantScope className={styles['panel-heading']}>
            <strong>AI Assistant</strong>
            <CloseOutlined aria-hidden="true" />
          </AssistantScope>
          <AssistantPanelLayout
            header={
              <ConversationHeader
                conversations={[{ id: 'c1', title: state.messages[0]?.content ?? 'New conversation' }]}
                activeId={state.messages.length ? 'c1' : null}
                onOpenList={() => undefined}
                onNew={() => undefined}
              />
            }
            composer={
              <Composer
                value={state.draft}
                onChange={() => undefined}
                onSend={() => undefined}
                running={state.running}
              />
            }
          >
            {state.messages.length === 0 ? <EmptyState /> : null}
            {state.messages.map((message, index) => (
              <Fragment key={message.id}>
                {message.role === 'user' ? (
                  <UserMessage>{message.content}</UserMessage>
                ) : (
                  <AssistantReply streaming={message.streaming} copyText={message.content}>
                    <MarkdownAnswer
                      content={message.content}
                      describeParagraph={describe}
                      onOpenParagraph={() => undefined}
                    />
                  </AssistantReply>
                )}
                {index === 0 && state.steps.length ? (
                  <ActionLog running={state.running} steps={state.steps}>
                    {state.approval && approvalTarget ? (
                      <ToolApproval
                        action={state.approval.action}
                        target={
                          <ParagraphLink
                            paragraphId={state.approval.paragraphId}
                            label={approvalTarget}
                            onOpen={() => undefined}
                          />
                        }
                        description={state.approval.description}
                        reviewHint={
                          state.approval.action === 'Edit paragraph' ? 'Review the change in the paragraph.' : undefined
                        }
                        state={state.approval.state}
                        canDecide={state.waiting}
                        onAllow={() => answer('allow')}
                        onSkip={() => answer('skip')}
                      />
                    ) : null}
                  </ActionLog>
                ) : null}
              </Fragment>
            ))}
            {!state.running && lastAssistant ? <AiDisclaimer /> : null}
            {state.status ? <RunStatus>{state.status}</RunStatus> : null}
          </AssistantPanelLayout>
        </div>
        <AssistantScope
          className={styles['notebook']}
          aria-label="Notebook (mock)"
          style={{ '--sc-layout-bg': token.colorBgLayout } as CSSProperties}
        >
          {state.paragraphs.map(paragraph => (
            <NotebookParagraph key={paragraph.id} paragraph={paragraph} canDecide={state.waiting} onDecide={answer} />
          ))}
        </AssistantScope>
      </div>
    </AssistantScope>
  );
};
