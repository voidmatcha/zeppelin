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

import * as styles from './AssistantPanel.css';

import { Fragment, memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  ActionLog,
  AiDisclaimer,
  AssistantReply,
  Composer,
  type ComposerInput,
  ConversationHeader,
  ConversationList,
  ConversationStart,
  EmptyState,
  ErrorNotice,
  JumpToLatest,
  LoadEarlier,
  PanelSkeleton,
  MarkdownAnswer,
  RunStatus,
  UserMessage,
  AssistantPanelLayout,
  type ParagraphLabel,
  type ToolStep,
  joinPages,
  type AssistantRunEvent,
  type AssistantMessage,
  type AssistantConversation,
  type AssistantTransport,
  readSelectedConversation,
  writeSelectedConversation
} from '@/entities/assistant';
import type { AssistantParagraphRef, AssistantRevealResult } from '@zeppelin/sdk';

import { useLatest, useStableCallback } from '@/shared/lib/useLatest';
import { useStickyScroll } from '@/shared/lib/useStickyScroll';
import { useConversationDrafts } from '../model/useConversationDrafts';

export interface AssistantPanelProps extends AssistantTransport {
  noteId?: string;
  draftOwner?: string;
  /** Host-side scroll, highlight and focus for a paragraph an answer mentions. */
  revealParagraph?: (paragraphId: string) => Promise<AssistantRevealResult>;
  /** The notebook's paragraphs in order; only ids in this list become links in answers. */
  paragraphs?: AssistantParagraphRef[];
}

const EARLIER_LOADING_MIN_MS = 500;

interface ToolCall {
  id: string;
  name: string;
  done: boolean;
}

// One run's tool calls, shown after the message the run followed. A reopened conversation shows the same log
// from the tool calls history keeps on each answer.
interface ToolLog {
  run: number;
  anchor: string | null;
  steps: ToolCall[];
}

// What each server tool did, in the user's words. Unknown tools show their own name.
const TOOL_LABELS: Record<string, string> = {
  list_paragraphs: 'Read paragraphs'
};
const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;
const toSteps = (calls: ToolCall[]): ToolStep[] =>
  calls.map(call => ({ id: call.id, label: toolLabel(call.name), status: call.done ? 'done' : 'running' }));

// Prompts today's read-only tools can answer; picking one fills the composer.
const SUGGESTIONS = [
  'Summarize what this notebook does',
  'Which interpreters do the paragraphs use?',
  'Where is data loaded in this notebook?'
];

interface PanelError {
  message: string;
  retry?: () => void;
}

// The host aborts a call made for a note it has already left; the panel catches up on its next render.
const isHostAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'The assistant request failed.';
};

// Inserts after the run's latest message.
const insertAfter = (messages: AssistantMessage[], afterId: string | null, message: AssistantMessage) => {
  const index = afterId === null ? -1 : messages.findIndex(item => item.id === afterId);
  return index < 0 ? [...messages, message] : [...messages.slice(0, index + 1), message, ...messages.slice(index + 1)];
};

type DeltaEvent = Extract<AssistantRunEvent, { type: 'message.delta' }>;

const upsertDelta = (messages: AssistantMessage[], event: DeltaEvent, afterId: string | null): AssistantMessage[] => {
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
  event: Extract<AssistantRunEvent, { type: 'message.done' }>,
  afterId: string | null
) => {
  const done: AssistantMessage = { id: event.messageId, role: 'assistant', content: event.content };
  return messages.some(message => message.id === event.messageId)
    ? messages.map(message => (message.id === event.messageId ? done : message))
    : insertAfter(messages, afterId, done);
};

/**
 * One turn of the conversation: a reopened answer's tool calls, then the message. Memoized, so a streamed token
 * re-renders only the turn it changes.
 */
const MessageTurn = memo(function MessageTurn({
  message,
  streaming,
  fromHistory,
  describeParagraph,
  onOpenParagraph
}: {
  message: AssistantMessage;
  streaming: boolean;
  fromHistory: boolean;
  describeParagraph: (paragraphId: string) => ParagraphLabel | undefined;
  onOpenParagraph?: (paragraphId: string, label: string) => void;
}) {
  if (message.role === 'user') return <UserMessage fromHistory={fromHistory}>{message.content}</UserMessage>;
  return (
    <>
      {message.toolCalls?.length ? (
        <ActionLog
          running={false}
          steps={message.toolCalls.map(call => ({ id: call.id, label: toolLabel(call.name), status: 'done' }))}
        />
      ) : null}
      {message.content ? (
        <AssistantReply streaming={streaming} copyText={message.content} fromHistory={fromHistory}>
          <MarkdownAnswer
            content={message.content}
            describeParagraph={describeParagraph}
            onOpenParagraph={onOpenParagraph}
          />
        </AssistantReply>
      ) : null}
    </>
  );
});

export const AssistantPanel = ({
  noteId,
  draftOwner,
  listConversations,
  createConversation,
  deleteConversation,
  getMessages,
  openRun,
  revealParagraph,
  paragraphs
}: AssistantPanelProps) => {
  // Title, else position as "#2": answers usually already say "paragraph" before the id.
  const describeParagraph = useMemo(() => {
    const labels = new Map(
      (paragraphs ?? []).map((paragraph, index): [string, ParagraphLabel] => {
        const title = paragraph.title?.trim();
        return [
          paragraph.id,
          title ? { text: title, name: title } : { text: `#${index + 1}`, name: `Paragraph ${index + 1}` }
        ];
      })
    );
    return (paragraphId: string) => labels.get(paragraphId);
  }, [paragraphs]);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Polite status for a finished answer and for paragraph links.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => setAnnouncement(''), [activeConversationId]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  // Every run's action log in the open conversation, so an earlier turn keeps its log.
  const [toolLogs, setToolLogs] = useState<ToolLog[]>([]);
  const [activeRun, setActiveRun] = useState<number | null>(null);
  const runCounterRef = useRef(0);
  const { prompt, draftSaveFailed, changePrompt, clearPrompt, restoreDraft, removeDraft } = useConversationDrafts(
    noteId,
    draftOwner
  );
  const promptRef = useLatest(prompt);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [mutatingConversation, setMutatingConversation] = useState(false);
  const [panelError, setPanelError] = useState<PanelError | null>(null);

  // The latest messages, for code that runs outside a render (a run picks its first anchor).
  const messagesRef = useLatest(messages);
  // Cursor for the page before the loaded history; null once the conversation start is loaded.
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // Whether the shown history came partly from scrolling up, so reaching its start is worth marking.
  const [loadedEarlier, setLoadedEarlier] = useState(false);
  const loadingEarlierRef = useRef(false);
  const composerInputRef = useRef<ComposerInput>(null);
  // The conversation list covers the panel; closing it returns focus to the title that opened it.
  const [listOpen, setListOpen] = useState(false);
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const listWasOpenRef = useRef(false);
  useEffect(() => {
    if (listWasOpenRef.current && !listOpen) listTriggerRef.current?.focus();
    listWasOpenRef.current = listOpen;
  }, [listOpen]);
  // Messages that came from history rather than this session, shown without the arrival motion.
  const [historyIds, setHistoryIds] = useState<ReadonlySet<string>>(() => new Set());
  const logContent = useMemo(() => ({ messages, toolLogs, running }), [messages, toolLogs, running]);
  const scroll = useStickyScroll(logContent, `${noteId}:${activeConversationId}`);

  const runControllerRef = useRef<AbortController | null>(null);
  const selectedConversationRef = useRef<string | null>(null);
  const messageRequestRef = useRef(0);
  const earlierFailedRef = useRef(false);
  const conversationOperationRef = useRef(0);
  const conversationMutationRef = useRef(false);

  // The host remounts the panel for another note or account, so only the open conversation can go stale.
  const isCurrent = (conversationId: string) => selectedConversationRef.current === conversationId;

  const loadMessages = async (conversationId: string) => {
    const request = ++messageRequestRef.current;
    const run = runCounterRef.current;
    earlierFailedRef.current = false;
    setLoading(true);
    setPanelError(null);
    try {
      const page = await getMessages(conversationId);
      if (
        isCurrent(conversationId) &&
        request === messageRequestRef.current &&
        run === runCounterRef.current &&
        !runControllerRef.current
      ) {
        setHistoryIds(new Set(page.messages.map(message => message.id)));
        setMessages(page.messages);
        // Stored history replaces the live log too; keeping both would show each tool twice after a reload.
        setToolLogs([]);
        setEarlierCursor(page.earlierCursor);
        setLoadedEarlier(false);
        restoreDraft(conversationId);
      }
    } catch (error) {
      if (isCurrent(conversationId) && request === messageRequestRef.current) {
        setPanelError({ message: errorMessage(error), retry: () => void loadMessages(conversationId) });
      }
    } finally {
      if (isCurrent(conversationId) && request === messageRequestRef.current) {
        setLoading(false);
      }
    }
  };

  // Loads the page before the shown history when the user scrolls to the top or asks for it.
  const loadEarlier = async () => {
    const conversationId = selectedConversationRef.current;
    const cursor = earlierCursor;
    if (!conversationId || !cursor || loadingEarlierRef.current) return;
    earlierFailedRef.current = false;
    const request = messageRequestRef.current;
    const stillCurrent = () => isCurrent(conversationId) && request === messageRequestRef.current;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    const startedAt = performance.now();
    try {
      const page = await getMessages(conversationId, cursor);
      // Keep the loading row up briefly so a fast response does not flash it unseen.
      const shown = performance.now() - startedAt;
      if (shown < EARLIER_LOADING_MIN_MS)
        await new Promise(resolve => setTimeout(resolve, EARLIER_LOADING_MIN_MS - shown));
      if (!stillCurrent()) return;
      scroll.keepPlaceBeforePrepend();
      setHistoryIds(current => new Set([...Array.from(current), ...page.messages.map(message => message.id)]));
      setMessages(current => joinPages(page.messages, current));
      setEarlierCursor(page.earlierCursor);
      setLoadedEarlier(true);
    } catch (error) {
      if (stillCurrent()) {
        // Stop the observer from retrying until the user asks again.
        earlierFailedRef.current = true;
        setPanelError({ message: errorMessage(error), retry: () => void loadEarlier() });
      }
    } finally {
      // Release even after a conversation switch, so the next conversation can load.
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
  };

  // Loads the earlier page when the top row comes into view. Re-created per cursor and load, since an
  // observer reports only changes and a short history keeps the row in view.
  const earlierRowRef = useRef<HTMLDivElement>(null);
  const onEarlierVisible = useEffectEvent(() => void loadEarlier());
  useEffect(() => {
    const root = scroll.ref.current;
    const row = earlierRowRef.current;
    if (!root || !row || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (!earlierFailedRef.current && entries.some(entry => entry.isIntersecting)) onEarlierVisible();
      },
      { root }
    );
    observer.observe(row);
    return () => observer.disconnect();
    // `scroll.ref` is a stable ref object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earlierCursor, loading, loadingEarlier]);

  // Leaves the open conversation for `next` (null: a new, unsaved one): its run stops being followed and its
  // history and logs go. The caller loads or restores what comes next.
  const showConversation = (next: string | null) => {
    runControllerRef.current?.abort();
    runControllerRef.current = null;
    setRunning(false);
    selectedConversationRef.current = next;
    if (noteId) writeSelectedConversation(noteId, next);
    setActiveConversationId(next);
    setMessages([]);
    setEarlierCursor(null);
    setLoadedEarlier(false);
    setToolLogs([]);
  };

  const selectConversation = (conversationId: string) => {
    if (conversationMutationRef.current) return;
    conversationOperationRef.current += 1;
    showConversation(conversationId);
    clearPrompt();
    void loadMessages(conversationId);
  };

  useEffect(() => {
    let mounted = true;
    const loadConversations = async () => {
      try {
        const nextConversations = await listConversations();
        if (!mounted) {
          return;
        }
        setConversations(nextConversations);
        const savedSelection = noteId ? readSelectedConversation(noteId) : null;
        const firstConversation =
          nextConversations.find(conversation => conversation.id === savedSelection) ?? nextConversations[0];
        if (firstConversation) {
          selectedConversationRef.current = firstConversation.id;
          setActiveConversationId(firstConversation.id);
          await loadMessages(firstConversation.id);
        } else {
          restoreDraft(null);
          setLoading(false);
        }
      } catch (error) {
        if (mounted) {
          setLoading(false);
          setPanelError({ message: errorMessage(error), retry: () => void loadConversations() });
        }
      }
    };

    void loadConversations();
    return () => {
      mounted = false;
      messageRequestRef.current += 1;
      runControllerRef.current?.abort();
    };
    // Once per mount: the host remounts the panel for another note or account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new conversation exists only here until send() creates it, so New never leaves an empty one behind.
  const startNewConversation = () => {
    if (loading || conversationMutationRef.current) {
      return;
    }
    conversationOperationRef.current += 1;
    messageRequestRef.current += 1;
    showConversation(null);
    restoreDraft(null);
    setPanelError(null);
    setLoading(false);
  };

  const removeConversation = async (conversationId: string) => {
    if (conversationMutationRef.current) {
      return;
    }
    conversationMutationRef.current = true;
    setMutatingConversation(true);
    const operation = ++conversationOperationRef.current;
    try {
      await deleteConversation(conversationId);
      if (operation !== conversationOperationRef.current) {
        return;
      }
      const remaining = conversations.filter(conversation => conversation.id !== conversationId);
      setConversations(remaining);
      removeDraft(conversationId);
      if (selectedConversationRef.current === conversationId) {
        messageRequestRef.current += 1;
        const next = remaining[0];
        showConversation(next?.id ?? null);
        restoreDraft(next?.id ?? null);
        if (next) {
          void loadMessages(next.id);
        } else {
          setLoading(false);
        }
      }
    } catch (error) {
      setPanelError({ message: errorMessage(error), retry: () => void removeConversation(conversationId) });
    } finally {
      if (operation === conversationOperationRef.current) {
        conversationMutationRef.current = false;
        setMutatingConversation(false);
      }
    }
  };

  const runPrompt = async (
    conversationId: string,
    text: string,
    appendUser: boolean
  ): Promise<'accepted' | 'rejected' | 'interrupted' | 'aborted'> => {
    const controller = new AbortController();
    let started = false;
    const userMessageId = appendUser ? `local-${Date.now()}` : null;
    runControllerRef.current?.abort();
    runControllerRef.current = controller;
    setPanelError(null);
    setAnnouncement('');
    setRunning(true);
    if (appendUser) {
      setMessages(current => [...current, { id: userMessageId!, role: 'user', content: text }]);
    }

    // Where this run's next new message goes: after its question, then after its latest answer.
    let anchorId: string | null = userMessageId ?? messagesRef.current[messagesRef.current.length - 1]?.id ?? null;
    const run = ++runCounterRef.current;
    setActiveRun(run);
    setToolLogs(current => [...current, { run, anchor: anchorId, steps: [] }]);
    const updateSteps = (update: (steps: ToolCall[]) => ToolCall[]) =>
      setToolLogs(current => current.map(log => (log.run === run ? { ...log, steps: update(log.steps) } : log)));
    // The server stores the question before run.started, so only a run refused before it can be retried as is. After
    // it, sending again would store the question twice; the text goes back to the input for the user to resend.
    const reportFailure = (message: string) => {
      if (started) {
        setPanelError({ message });
        const restoredPrompt = promptRef.current || text;
        changePrompt(conversationId, restoredPrompt);
      } else {
        setPanelError({ message, retry: () => void runPrompt(conversationId, text, false) });
      }
    };
    // Tokens arrive faster than frames; applying them once per frame re-parses the streaming answer once per frame.
    let pendingDeltas: Array<{ event: DeltaEvent; after: string | null }> = [];
    let frame = 0;
    const flushDeltas = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!pendingDeltas.length) return;
      const batch = pendingDeltas;
      pendingDeltas = [];
      scroll.noteNewContent();
      setMessages(current =>
        batch.reduce((messages, { event, after }) => upsertDelta(messages, event, after), current)
      );
    };
    try {
      for await (const event of openRun(conversationId, { prompt: text }, controller.signal)) {
        if (!isCurrent(conversationId) || controller.signal.aborted) {
          break;
        }
        // Any other event lands after the text before it.
        if (event.type !== 'message.delta') flushDeltas();
        switch (event.type) {
          case 'message.delta': {
            const previous = pendingDeltas[pendingDeltas.length - 1];
            if (previous?.event.messageId === event.messageId) {
              previous.event = { ...previous.event, delta: previous.event.delta + event.delta };
            } else {
              pendingDeltas.push({ event, after: anchorId });
            }
            if (!frame) frame = requestAnimationFrame(flushDeltas);
            anchorId = event.messageId;
            break;
          }
          case 'message.done': {
            scroll.noteNewContent();
            const after = anchorId;
            setMessages(current => reconcileMessage(current, event, after));
            anchorId = event.messageId;
            break;
          }
          case 'tool_call.started':
            updateSteps(current => [
              ...current.filter(step => step.id !== event.toolCallId),
              { id: event.toolCallId, name: event.name, done: false }
            ]);
            break;
          case 'tool_call.done':
            updateSteps(current =>
              current.some(step => step.id === event.toolCallId)
                ? current.map(step =>
                    step.id === event.toolCallId ? { ...step, name: event.name ?? step.name, done: true } : step
                  )
                : [...current, { id: event.toolCallId, name: event.name ?? 'tool', done: true }]
            );
            break;
          case 'run.failed':
            reportFailure(event.message);
            return started ? 'accepted' : 'rejected';
          case 'run.started':
            started = true;
            break;
          case 'run.completed':
            // Said once at the end, since the streamed text itself is not announced.
            setAnnouncement('Answer ready.');
            return 'accepted';
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && !isHostAbort(error) && isCurrent(conversationId)) {
        // A transport error does not prove the server rejected the question. Reload its stored state rather
        // than resend it or discard a newly created conversation whose first run may already have finished.
        setPanelError({ message: errorMessage(error), retry: () => void loadMessages(conversationId) });
      }
    } finally {
      // Text still waiting for a frame shows if this conversation is still open, and is dropped otherwise.
      if (isCurrent(conversationId) && !controller.signal.aborted) flushDeltas();
      else cancelAnimationFrame(frame);
      if (runControllerRef.current === controller) {
        runControllerRef.current = null;
        if (isCurrent(conversationId)) {
          setRunning(false);
        }
      }
    }
    return controller.signal.aborted ? 'aborted' : 'interrupted';
  };

  // The server decides who can send (canSendMessage) and enforces it; the panel only follows it.
  const isReadOnly = (conversation?: AssistantConversation) => conversation?.canSendMessage === false;

  const send = useStableCallback(async () => {
    const text = prompt.trim();
    if (
      !text ||
      running ||
      loading ||
      conversationMutationRef.current ||
      isReadOnly(conversations.find(conversation => conversation.id === activeConversationId))
    ) {
      return;
    }
    let conversationId = activeConversationId;
    let created = false;
    if (!conversationId) {
      conversationMutationRef.current = true;
      setMutatingConversation(true);
      try {
        // Named after the first question; the server would otherwise use the creation time.
        const conversation = await createConversation({ title: text });
        created = true;
        setConversations(current => [conversation, ...current]);
        selectedConversationRef.current = conversation.id;
        if (noteId) writeSelectedConversation(noteId, conversation.id);
        setActiveConversationId(conversation.id);
        conversationId = conversation.id;
      } catch (error) {
        setPanelError({ message: errorMessage(error), retry: () => void send() });
        return;
      } finally {
        conversationMutationRef.current = false;
        setMutatingConversation(false);
      }
    }
    changePrompt(activeConversationId, '');
    // The list is latest activity first, and sending is activity: the conversation moves to the top.
    const sentAt = new Date().toISOString();
    setConversations(current => {
      const sent = current.find(conversation => conversation.id === conversationId);
      return sent
        ? [{ ...sent, updatedAt: sentAt }, ...current.filter(conversation => conversation !== sent)]
        : current;
    });
    scroll.followBottom();
    const outcome = await runPrompt(conversationId, text, true);
    if (created && outcome === 'rejected' && isCurrent(conversationId)) {
      discardNewConversation(conversationId, text);
    }
  });

  // The first message was rejected before the run started: delete the empty conversation and restore the text.
  const discardNewConversation = (conversationId: string, text: string) => {
    void deleteConversation(conversationId).catch(() => undefined);
    setConversations(current => current.filter(conversation => conversation.id !== conversationId));
    showConversation(null);
    changePrompt(null, text);
    setPanelError(current => (current ? { message: current.message } : current));
  };

  // Only runs on a click, so the user has asked to move; a missing paragraph is reported instead. Stable, so a
  // streamed token re-renders only the answer it changes.
  const openMentionedParagraph = useCallback(
    (paragraphId: string, label: string) => {
      setAnnouncement('');
      let shown: Promise<AssistantRevealResult> | undefined;
      try {
        shown = revealParagraph?.(paragraphId);
      } catch {
        // The host refuses a note it has already left; the panel catches up on its next render.
        return;
      }
      void shown
        ?.then(result => {
          if (result === 'missing') setAnnouncement(`${label} is no longer available in this notebook.`);
        })
        .catch(() => undefined);
    },
    [revealParagraph]
  );

  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId);
  const readOnly = isReadOnly(activeConversation);
  const lastMessage = messages[messages.length - 1];
  const hasRunningTool = toolLogs.some(log => log.run === activeRun && log.steps.some(step => !step.done));
  const hasAnswerContent = lastMessage?.role === 'assistant' && Boolean(lastMessage.content);
  const progress = hasRunningTool ? 'Reading notebook context…' : hasAnswerContent ? 'Writing response…' : 'Thinking…';
  const readOnlyNotice = (() => {
    if (!readOnly) return undefined;
    if (activeConversation?.ownerId && activeConversation.ownerId !== draftOwner) {
      return `Started by ${activeConversation.ownerId}. Only they can continue this conversation. Start a new conversation to ask your own question.`;
    }
    return 'You cannot send messages to this conversation. Start a new conversation to ask your question.';
  })();
  // Each run's log after the message it followed, grouped once per change rather than per message.
  const logs = useMemo(() => {
    const ids = new Set(messages.map(message => message.id));
    const byAnchor = new Map<string, ToolLog[]>();
    const unanchored: ToolLog[] = [];
    for (const log of toolLogs) {
      if (!log.steps.length) continue;
      if (log.anchor !== null && ids.has(log.anchor))
        byAnchor.set(log.anchor, [...(byAnchor.get(log.anchor) ?? []), log]);
      else unanchored.push(log);
    }
    return { byAnchor, unanchored };
  }, [messages, toolLogs]);
  // Stable inputs for the memoized header, which a streamed token would otherwise re-render.
  const conversationOptions = useMemo(
    () =>
      conversations.map(conversation => ({
        id: conversation.id,
        title: conversation.title,
        readOnly: isReadOnly(conversation),
        owner: conversation.ownerId && conversation.ownerId !== draftOwner ? conversation.ownerId : undefined,
        updatedAt: conversation.updatedAt
      })),
    [conversations, draftOwner]
  );
  const onOpenList = useStableCallback(() => setListOpen(true));
  const onNewConversation = useStableCallback(startNewConversation);
  const onDeleteConversation = useStableCallback((conversationId: string) => {
    // The open one's delete button goes away with it; the input keeps keyboard focus in the panel.
    if (conversationId === activeConversationId) composerInputRef.current?.focus();
    void removeConversation(conversationId);
  });
  const renderLog = (log: ToolLog) => (
    <ActionLog key={log.run} steps={toSteps(log.steps)} running={running && log.run === activeRun} />
  );
  return (
    <AssistantPanelLayout
      className={styles.panel}
      logRef={scroll.ref}
      onLogScroll={scroll.onScroll}
      overlay={
        listOpen ? (
          <ConversationList
            conversations={conversationOptions}
            activeId={activeConversationId}
            onSelect={conversationId => {
              setListOpen(false);
              if (conversationId !== activeConversationId) selectConversation(conversationId);
            }}
            onNew={() => {
              setListOpen(false);
              startNewConversation();
            }}
            onDelete={onDeleteConversation}
            onClose={() => setListOpen(false)}
            busy={mutatingConversation}
            newDisabled={loading}
          />
        ) : undefined
      }
      header={
        <ConversationHeader
          conversations={conversationOptions}
          activeId={activeConversationId}
          onOpenList={onOpenList}
          listOpen={listOpen}
          triggerRef={listTriggerRef}
          onNew={onNewConversation}
          onDelete={onDeleteConversation}
          busy={mutatingConversation}
          newDisabled={loading}
        />
      }
      composer={
        <Composer
          value={prompt}
          onChange={text => changePrompt(activeConversationId, text)}
          ref={composerInputRef}
          onSend={() => void send()}
          running={running}
          busy={loading || mutatingConversation}
          readOnly={readOnly}
          readOnlyNotice={readOnlyNotice}
          status={draftSaveFailed ? 'Draft is kept here, but cannot be restored after a reload.' : undefined}
          overlay={scroll.hasNewContent ? <JumpToLatest onJump={scroll.jumpToBottom} /> : undefined}
        />
      }
    >
      {loading ? <PanelSkeleton label="Loading conversation…" /> : null}
      {!loading && earlierCursor ? (
        <div ref={earlierRowRef}>
          <LoadEarlier loading={loadingEarlier} onLoad={() => void loadEarlier()} />
        </div>
      ) : null}
      {!loading && !earlierCursor && loadedEarlier ? <ConversationStart /> : null}
      {!loading && messages.length === 0 ? (
        <EmptyState
          suggestions={readOnly ? [] : SUGGESTIONS}
          onPick={text => {
            changePrompt(activeConversationId, text);
            composerInputRef.current?.focus();
          }}
        />
      ) : null}
      {messages.map((message, index) => (
        <Fragment key={message.id}>
          <MessageTurn
            message={message}
            streaming={running && index === messages.length - 1}
            fromHistory={historyIds.has(message.id)}
            describeParagraph={describeParagraph}
            onOpenParagraph={revealParagraph ? openMentionedParagraph : undefined}
          />
          {logs.byAnchor.get(message.id)?.map(renderLog)}
        </Fragment>
      ))}
      {logs.unanchored.map(renderLog)}
      {!running && hasAnswerContent ? <AiDisclaimer /> : null}
      <p role="status" className={styles.announcement}>
        {announcement}
      </p>
      {running ? <RunStatus>{progress}</RunStatus> : null}
      {panelError ? <ErrorNotice message={panelError.message} onRetry={panelError.retry} /> : null}
    </AssistantPanelLayout>
  );
};
