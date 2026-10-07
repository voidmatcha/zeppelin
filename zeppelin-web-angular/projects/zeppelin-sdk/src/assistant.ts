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

import type {
  AssistantEvent as AssistantSocketEvent,
  AssistantSendMessage,
  AssistantToolDecision
} from './interfaces/message-assistant.interface';

/** ASSISTANT_EVENT as the server sends it; the remote maps it to its run events. */
export type { AssistantSocketEvent };

/** The host's notebook WebSocket, narrowed to the assistant ops. */
export interface AssistantSocket {
  send(message: AssistantSendMessage): void;
  /** Answers an approval request on the connection that started the run. */
  decide(message: AssistantToolDecision): void;
  subscribe(listener: (event: AssistantSocketEvent) => void): () => void;
  /** The connection closed. The server sends a run's events only to the connection that started it. */
  subscribeClose(listener: () => void): () => void;
}

/** The notebook sidebar's width: its default and its resize range. The assistant panel shares it. */
export const NOTEBOOK_SIDEBAR_WIDTH = { initial: 370, min: 280, max: 800 } as const;

/** How the host reveals a paragraph. */
export interface AssistantRevealOptions {
  /** Move keyboard focus to it (default). False when the panel shows it on its own, e.g. for an approval. */
  focus?: boolean;
}

/** Result of a host reveal: scrolled to it, already visible, or not rendered. */
export type AssistantRevealResult = 'shown' | 'visible' | 'missing';

/** A notebook paragraph as the remote sees it: enough to label and link it. */
export interface AssistantParagraphRef {
  id: string;
  title?: string;
}

/** A host element the remote portals into: the sidebar button or the panel area. */
export interface AssistantSlot {
  element: HTMLElement;
  kind: 'navigation' | 'panel';
}

/** Props the Angular notebook passes to the `./AssistantWorkspace` remote. A type alias, so it fits `ReactProps`. */
export type AssistantHostProps = {
  noteId: string;
  /** The host's REST base (`.../api`); the remote calls the conversation REST API itself. */
  apiBase: string;
  /** The host's notebook WebSocket, used to send messages and receive run events. */
  socket: AssistantSocket;
  draftOwner?: string;
  slots: AssistantSlot[];
  onAuthError?: (status: number, location: string | null) => void;
  onError?: (error: unknown) => void;
  /** Keeps the host sidebar to one open view at a time. */
  onPanelVisibilityChange?: (visible: boolean) => void;
  subscribePanelClose?: (listener: () => void) => () => void;
  /** Host-side scroll and highlight for a paragraph an answer links to; notebook DOM stays with Angular. */
  revealParagraph?: (paragraphId: string, options?: AssistantRevealOptions) => Promise<AssistantRevealResult>;
  /** The notebook's paragraphs in order, as data so labelling them never calls into the host. */
  paragraphs?: AssistantParagraphRef[];
  /** The notebook sidebar's width, which the panel shares so switching views keeps it. */
  panelWidth?: number;
  /** A resize of the panel, at the end of a drag or per arrow key. */
  onPanelWidthChange?: (width: number) => void;
  /** Shows a proposed paragraph edit as a diff inside that paragraph; replaces one with the same toolCallId. */
  showProposal?: (proposal: AssistantParagraphProposal) => void;
  clearProposal?: (toolCallId: string) => void;
  /** Decisions made in the paragraph, so the panel answers them as if made on its own card. */
  subscribeProposalDecisions?: (
    listener: (toolCallId: string, decision: AssistantToolDecision['decision']) => void
  ) => () => void;
};

/** A proposed edit of one paragraph, waiting for the conversation owner. */
export interface AssistantParagraphProposal {
  toolCallId: string;
  paragraphId: string;
  /** The paragraph text after the edit; the host diffs it against the current text. */
  text: string;
}
