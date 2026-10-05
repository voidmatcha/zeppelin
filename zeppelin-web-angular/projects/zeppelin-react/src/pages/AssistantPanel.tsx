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

import { useEffect, useRef, useState } from 'react';
import { DeleteOutlined, PlusOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Input, theme } from 'antd';
import type { AssistantEvent, AssistantMessage, AssistantThread, AssistantTransport } from '@zeppelin/sdk';
import { readDraft, readSelectedThread, writeDraft, writeSelectedThread } from './assistantSession';
import './AssistantPanel.css';

export interface AssistantPanelProps extends AssistantTransport {
  noteId?: string;
  /** Signed-in account; drafts are kept per account and note. */
  draftOwner?: string;
}

interface ToolStep {
  id: string;
  name: string;
  done: boolean;
}

interface PanelError {
  message: string;
  retry?: () => void;
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'The assistant request failed.';
};

// Inserts after the run's latest message, so a stopped run that keeps streaming stays above a later question.
const insertAfter = (messages: AssistantMessage[], afterId: string | null, message: AssistantMessage) => {
  const index = afterId === null ? -1 : messages.findIndex(item => item.id === afterId);
  return index < 0 ? [...messages, message] : [...messages.slice(0, index + 1), message, ...messages.slice(index + 1)];
};

const upsertDelta = (
  messages: AssistantMessage[],
  event: Extract<AssistantEvent, { type: 'message.delta' }>,
  afterId: string | null
): AssistantMessage[] => {
  const index = messages.findIndex(message => message.id === event.messageId);
  if (index < 0) {
    return insertAfter(messages, afterId, { id: event.messageId, role: 'assistant', content: event.delta });
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index ? { ...message, content: message.content + event.delta } : message
  );
};

const reconcileMessage = (
  messages: AssistantMessage[],
  event: Extract<AssistantEvent, { type: 'message.done' }>,
  afterId: string | null
) => {
  const done: AssistantMessage = { id: event.messageId, role: 'assistant', content: event.content };
  return messages.some(message => message.id === event.messageId)
    ? messages.map(message => (message.id === event.messageId ? done : message))
    : insertAfter(messages, afterId, done);
};

export const AssistantPanel = ({
  noteId,
  draftOwner,
  listThreads,
  createThread,
  deleteThread,
  getMessages,
  openRun
}: AssistantPanelProps) => {
  const { token } = theme.useToken();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [mutatingThread, setMutatingThread] = useState(false);
  const [panelError, setPanelError] = useState<PanelError | null>(null);
  // Polite status line, for example after Stop.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => setAnnouncement(''), [activeThreadId]);

  // Unsent text per conversation (null: the new conversation), kept in session storage per account and note.
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const draftsRef = useRef(new Map<string | null, string>());
  const draftScope = noteId && draftOwner ? JSON.stringify([draftOwner, noteId]) : noteId;
  const restoreDraft = (threadId: string | null) => {
    setPrompt(
      draftsRef.current.get(threadId) ?? (draftScope && (threadId || draftOwner) ? readDraft(draftScope, threadId) : '')
    );
    setDraftSaveFailed(false);
  };
  const saveDraft = (threadId: string | null, text: string) => {
    draftsRef.current.set(threadId, text);
    const saved = !draftScope || (!threadId && !draftOwner) || writeDraft(draftScope, threadId, text);
    setDraftSaveFailed(!saved);
  };

  // The latest messages, for code that runs outside a render (a run picks its first anchor).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const conversationRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [hasNewReply, setHasNewReply] = useState(false);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation && stickToBottom.current) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }, [messages, toolSteps, running]);
  useEffect(() => {
    stickToBottom.current = true;
    setHasNewReply(false);
  }, [activeThreadId, noteId]);

  // Stopped runs keep streaming into the panel until they end or the thread or note changes (no server cancel).
  const detachedRunsRef = useRef(new Set<AbortController>());
  const abortDetachedRuns = () => {
    detachedRunsRef.current.forEach(controller => controller.abort());
    detachedRunsRef.current.clear();
  };

  const scopeRef = useRef({ noteId, draftOwner, generation: 0 });
  const runControllerRef = useRef<AbortController | null>(null);
  const selectedThreadRef = useRef<string | null>(null);
  const messageRequestRef = useRef(0);
  const threadOperationRef = useRef(0);
  const threadMutationRef = useRef(false);

  // Invalidated during render: a host note change lands before effects run, and a late response could slip in.
  if (scopeRef.current.noteId !== noteId || scopeRef.current.draftOwner !== draftOwner) {
    scopeRef.current = { noteId, draftOwner, generation: scopeRef.current.generation + 1 };
    runControllerRef.current?.abort();
    abortDetachedRuns();
  }

  const isCurrent = (generation: number, threadId?: string) =>
    scopeRef.current.generation === generation && (threadId === undefined || selectedThreadRef.current === threadId);

  // Stops listening to the current conversation before the panel shows another one.
  const leaveConversation = () => {
    runControllerRef.current?.abort();
    abortDetachedRuns();
    runControllerRef.current = null;
    setRunning(false);
    setMessages([]);
    setToolSteps([]);
  };

  const loadMessages = async (threadId: string, generation: number) => {
    const request = ++messageRequestRef.current;
    setLoading(true);
    setPanelError(null);
    try {
      const page = await getMessages(threadId);
      if (isCurrent(generation, threadId) && request === messageRequestRef.current) {
        setMessages(page.messages);
        restoreDraft(threadId);
      }
    } catch (error) {
      if (isCurrent(generation, threadId) && request === messageRequestRef.current) {
        setPanelError({ message: errorMessage(error), retry: () => void loadMessages(threadId, generation) });
      }
    } finally {
      if (isCurrent(generation, threadId) && request === messageRequestRef.current) {
        setLoading(false);
      }
    }
  };

  const selectThread = (threadId: string) => {
    threadOperationRef.current += 1;
    leaveConversation();
    selectedThreadRef.current = threadId;
    if (noteId) writeSelectedThread(noteId, threadId);
    setActiveThreadId(threadId);
    setPrompt('');
    void loadMessages(threadId, scopeRef.current.generation);
  };

  useEffect(() => {
    const generation = scopeRef.current.generation;
    selectedThreadRef.current = null;
    messageRequestRef.current += 1;
    setThreads([]);
    setActiveThreadId(null);
    setMessages([]);
    setToolSteps([]);
    setPanelError(null);
    setLoading(true);
    setRunning(false);
    setMutatingThread(false);
    setPrompt('');
    draftsRef.current.clear();
    setDraftSaveFailed(false);
    runControllerRef.current = null;
    threadMutationRef.current = false;

    const loadThreads = async () => {
      try {
        const nextThreads = (await listThreads({ noteId })).filter(
          thread => !thread.noteId || !noteId || thread.noteId === noteId
        );
        if (!isCurrent(generation)) {
          return;
        }
        setThreads(nextThreads);
        const savedSelection = noteId ? readSelectedThread(noteId) : null;
        const firstThread = nextThreads.find(thread => thread.id === savedSelection) ?? nextThreads[0];
        if (firstThread) {
          selectedThreadRef.current = firstThread.id;
          setActiveThreadId(firstThread.id);
          await loadMessages(firstThread.id, generation);
        } else {
          restoreDraft(null);
          setLoading(false);
        }
      } catch (error) {
        if (isCurrent(generation)) {
          setLoading(false);
          setPanelError({ message: errorMessage(error), retry: () => void loadThreads() });
        }
      }
    };

    void loadThreads();
    return () => {
      scopeRef.current.generation += 1;
      messageRequestRef.current += 1;
      runControllerRef.current?.abort();
      abortDetachedRuns();
    };
    // Transport identities are memoized by the host. A note change owns this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, draftOwner]);

  // A new conversation exists only here until send() creates it, so New never leaves an empty one behind.
  const startNewThread = () => {
    if (loading || threadMutationRef.current) {
      return;
    }
    threadOperationRef.current += 1;
    leaveConversation();
    messageRequestRef.current += 1;
    selectedThreadRef.current = null;
    if (noteId) writeSelectedThread(noteId, null);
    setActiveThreadId(null);
    restoreDraft(null);
    setPanelError(null);
    setLoading(false);
  };

  const removeThread = async (threadId: string) => {
    if (threadMutationRef.current) {
      return;
    }
    threadMutationRef.current = true;
    setMutatingThread(true);
    const generation = scopeRef.current.generation;
    const operation = ++threadOperationRef.current;
    try {
      await deleteThread(threadId);
      if (!isCurrent(generation) || operation !== threadOperationRef.current) {
        return;
      }
      const remaining = threads.filter(thread => thread.id !== threadId);
      setThreads(remaining);
      draftsRef.current.delete(threadId);
      if (draftScope) writeDraft(draftScope, threadId, '');
      if (selectedThreadRef.current === threadId) {
        messageRequestRef.current += 1;
        leaveConversation();
        const next = remaining[0];
        selectedThreadRef.current = next?.id ?? null;
        if (noteId) writeSelectedThread(noteId, next?.id ?? null);
        setActiveThreadId(next?.id ?? null);
        restoreDraft(next?.id ?? null);
        if (next) {
          void loadMessages(next.id, generation);
        } else {
          setLoading(false);
        }
      }
    } catch (error) {
      if (isCurrent(generation)) {
        setPanelError({ message: errorMessage(error), retry: () => void removeThread(threadId) });
      }
    } finally {
      if (isCurrent(generation) && operation === threadOperationRef.current) {
        threadMutationRef.current = false;
        setMutatingThread(false);
      }
    }
  };

  const runPrompt = async (
    threadId: string,
    text: string,
    appendUser: boolean
  ): Promise<'started' | 'failed' | 'aborted'> => {
    const generation = scopeRef.current.generation;
    const controller = new AbortController();
    let started = false;
    const userMessageId = appendUser ? `local-${generation}-${Date.now()}` : null;
    runControllerRef.current?.abort();
    runControllerRef.current = controller;
    setPanelError(null);
    setAnnouncement('');
    setToolSteps([]);
    setRunning(true);
    if (appendUser) {
      setMessages(current => [...current, { id: userMessageId!, role: 'user', content: text }]);
    }

    // Where this run's next new message goes: after its question, then after its latest answer.
    let anchorId: string | null = userMessageId ?? messagesRef.current[messagesRef.current.length - 1]?.id ?? null;
    const detached = () => detachedRunsRef.current.has(controller);
    try {
      for await (const event of openRun(threadId, { prompt: text }, controller.signal)) {
        if (!isCurrent(generation, threadId) || controller.signal.aborted) {
          break;
        }
        switch (event.type) {
          case 'message.delta': {
            if (!stickToBottom.current) setHasNewReply(true);
            const after = anchorId;
            setMessages(current => upsertDelta(current, event, after));
            anchorId = event.messageId;
            break;
          }
          case 'message.done': {
            if (!stickToBottom.current) setHasNewReply(true);
            const after = anchorId;
            setMessages(current => reconcileMessage(current, event, after));
            anchorId = event.messageId;
            break;
          }
          case 'tool_call.started':
            if (detached()) break;
            setToolSteps(current => [
              ...current.filter(step => step.id !== event.toolCallId),
              { id: event.toolCallId, name: event.name, done: false }
            ]);
            break;
          case 'tool_call.done':
            // A stopped run only completes steps already shown.
            setToolSteps(current =>
              current.some(step => step.id === event.toolCallId)
                ? current.map(step =>
                    step.id === event.toolCallId ? { ...step, name: event.name ?? step.name, done: true } : step
                  )
                : detached()
                  ? current
                  : [...current, { id: event.toolCallId, name: event.name ?? 'tool', done: true }]
            );
            break;
          case 'run.failed':
            if (detached()) return 'started';
            setPanelError({ message: event.message, retry: () => void runPrompt(threadId, text, false) });
            return started ? 'started' : 'failed';
          case 'run.started':
            started = true;
            break;
          case 'run.completed':
            return 'started';
        }
      }
    } catch (error) {
      const hostAborted = error instanceof DOMException && error.name === 'AbortError';
      if (!controller.signal.aborted && !hostAborted && !detached() && isCurrent(generation, threadId)) {
        setPanelError({ message: errorMessage(error), retry: () => void runPrompt(threadId, text, false) });
      }
    } finally {
      detachedRunsRef.current.delete(controller);
      if (runControllerRef.current === controller) {
        runControllerRef.current = null;
        if (isCurrent(generation, threadId)) {
          setRunning(false);
        }
      }
    }
    return controller.signal.aborted ? 'aborted' : started ? 'started' : 'failed';
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || running || loading || threadMutationRef.current) {
      return;
    }
    let threadId = activeThreadId;
    let created = false;
    const generation = scopeRef.current.generation;
    if (!threadId) {
      threadMutationRef.current = true;
      setMutatingThread(true);
      try {
        // Named after the first question; the server would otherwise use the creation time.
        const thread = await createThread({ noteId, title: text });
        created = true;
        if (!isCurrent(generation)) {
          return;
        }
        setThreads(current => [thread, ...current]);
        selectedThreadRef.current = thread.id;
        if (noteId) writeSelectedThread(noteId, thread.id);
        setActiveThreadId(thread.id);
        threadId = thread.id;
      } catch (error) {
        if (isCurrent(generation)) {
          setPanelError({ message: errorMessage(error), retry: () => void send() });
        }
        return;
      } finally {
        if (isCurrent(generation)) {
          threadMutationRef.current = false;
          setMutatingThread(false);
        }
      }
    }
    saveDraft(activeThreadId, '');
    setPrompt('');
    stickToBottom.current = true;
    setHasNewReply(false);
    const outcome = await runPrompt(threadId, text, true);
    if (created && outcome === 'failed' && isCurrent(generation, threadId)) {
      discardNewThread(threadId, text);
    }
  };

  // The first message was rejected before the run started: delete the empty conversation and restore the text.
  const discardNewThread = (threadId: string, text: string) => {
    void deleteThread(threadId).catch(() => undefined);
    setThreads(current => current.filter(thread => thread.id !== threadId));
    selectedThreadRef.current = null;
    if (noteId) writeSelectedThread(noteId, null);
    setActiveThreadId(null);
    setMessages([]);
    setPrompt(text);
    setPanelError(current => (current ? { message: current.message } : current));
  };

  // Stops waiting, not the server (no cancel op): the text keeps arriving in place while the composer is free.
  const stop = () => {
    const controller = runControllerRef.current;
    runControllerRef.current = null;
    setRunning(false);
    if (controller) {
      detachedRunsRef.current.add(controller);
      setAnnouncement('Stopped waiting. The server is still finishing this answer, so it keeps arriving.');
    }
  };

  const activeThread = threads.find(thread => thread.id === activeThreadId);
  // The server decides who can send and enforces it; the panel only follows it.
  const readOnly = activeThread?.canSendMessage === false;
  return (
    <section
      aria-label="AI Assistant"
      className="assistant-panel"
      style={
        {
          color: token.colorText,
          background: token.colorBgContainer,
          '--assistant-text': token.colorText,
          '--assistant-border': token.colorBorderSecondary,
          '--assistant-muted': token.colorTextSecondary,
          '--assistant-surface': token.colorFillQuaternary,
          '--assistant-accent': token.colorPrimary
        } as React.CSSProperties
      }
    >
      <header className="assistant-header">
        <select
          aria-label="Thread"
          value={activeThreadId ?? ''}
          disabled={mutatingThread}
          onChange={event => selectThread(event.target.value)}
        >
          {!activeThreadId ? <option value="">New conversation</option> : null}
          {threads.map(thread => (
            <option key={thread.id} value={thread.id}>
              {thread.title || 'New conversation'}
            </option>
          ))}
        </select>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label="New thread"
          title="New thread"
          disabled={loading || mutatingThread}
          onClick={startNewThread}
        />
        {activeThreadId && !readOnly ? (
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            aria-label={`Delete ${activeThread?.title ?? 'thread'}`}
            title="Delete thread"
            disabled={mutatingThread}
            onClick={() => void removeThread(activeThreadId)}
          />
        ) : null}
      </header>
      <div
        aria-label="Messages"
        className="assistant-conversation"
        ref={conversationRef}
        onScroll={event => {
          const area = event.currentTarget;
          stickToBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 32;
          if (stickToBottom.current) setHasNewReply(false);
        }}
      >
        {loading ? <p role="status">Loading conversation…</p> : null}
        {!loading && messages.length === 0 ? (
          <div className="assistant-empty">
            <strong>How can I help?</strong>
            <p>Ask about your notebook, explore data, or draft a query.</p>
          </div>
        ) : null}
        {messages.map(message => (
          <article className="assistant-turn" key={message.id} data-role={message.role}>
            <div className="assistant-role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
            {message.role === 'user' ? (
              <blockquote>{message.content}</blockquote>
            ) : (
              // Plain text: the model's reply is never interpreted as HTML.
              <div className="assistant-answer">{message.content}</div>
            )}
          </article>
        ))}
        {toolSteps.map(step => (
          <details key={step.id} className="assistant-tool">
            <summary>
              {step.done ? '✓' : '…'} {step.name}
            </summary>
            <p>
              {step.done ? 'Completed' : 'In progress'}: {step.name}
            </p>
          </details>
        ))}
        <p role="status" className="assistant-announcement">
          {announcement}
        </p>
        {running ? (
          <div role="status" className="assistant-progress">
            {toolSteps.some(step => !step.done)
              ? 'Reading notebook context…'
              : messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content
                ? 'Writing response…'
                : 'Thinking…'}
          </div>
        ) : null}
        {panelError ? (
          <Alert
            type="error"
            showIcon
            message={panelError.message}
            action={
              panelError.retry ? (
                <Button size="small" onClick={panelError.retry}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </div>
      <footer className="assistant-composer">
        {hasNewReply ? (
          <div className="assistant-new-reply">
            <Button
              size="small"
              onClick={() => {
                const conversation = conversationRef.current;
                if (conversation) conversation.scrollTop = conversation.scrollHeight;
                stickToBottom.current = true;
                setHasNewReply(false);
              }}
            >
              <span aria-hidden="true">↓ </span>New reply
            </Button>
          </div>
        ) : null}
        {readOnly ? (
          <p className="assistant-read-only" role="note">
            You cannot send messages to this conversation. Start a new conversation to ask your question.
          </p>
        ) : null}
        <Input.TextArea
          value={prompt}
          onChange={event => {
            setPrompt(event.target.value);
            saveDraft(activeThreadId, event.target.value);
          }}
          onPressEnter={event => {
            if (!event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          aria-label="Message"
          placeholder="Ask about this notebook"
          autoSize={{ minRows: 2, maxRows: 5 }}
          disabled={readOnly || running || loading || mutatingThread}
        />
        {draftSaveFailed ? (
          <small role="status">Draft is kept here, but cannot be restored after a reload.</small>
        ) : null}
        <div className="assistant-composer-actions">
          <small>Shift + Enter for a new line</small>
          {running ? (
            <Button icon={<StopOutlined />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined aria-hidden="true" />}
              disabled={readOnly || !prompt.trim() || loading || mutatingThread}
              onClick={() => void send()}
            >
              Send
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
};
