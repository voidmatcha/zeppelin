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

import { ChangeDetectorRef, Component, DoCheck, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Note, OP, type AssistantHostProps, type AssistantSocket } from '@zeppelin/sdk';
import { BaseUrlService, MessageService, TicketService } from '@zeppelin/services';
import { AssistantProposals } from './assistant-proposals';
import { AssistantReveal } from './assistant-reveal';
import { AssistantSlots } from './assistant-slots';

@Component({
  selector: 'zeppelin-assistant-host',
  template: `
    @if (useAssistantPanel) {
      @if (assistantPanelFailed) {
        <p role="alert">Unable to load the assistant.</p>
      } @else {
        <div zeppelin-react-mount="./AssistantWorkspace" [reactProps]="assistantProps ?? {}"></div>
      }
    }
  `,
  standalone: false
})
export class AssistantHostComponent implements OnInit, DoCheck, OnDestroy {
  /** A resize of the panel, so the notebook sidebar keeps the same width. */
  @Output() readonly panelWidthChange = new EventEmitter<number>();
  useAssistantPanel = false;
  assistantPanelFailed = false;
  /** Props for the remote; rebuilt after an invalidation, and refreshed when the paragraph list changes. */
  assistantProps: AssistantHostProps | null = null;

  // Sending and run events share the notebook WebSocket, which Angular owns.
  readonly assistantSocket: AssistantSocket = {
    send: message => {
      if (message.noteId !== this.note?.id) {
        throw new DOMException('Notebook changed', 'AbortError');
      }
      this.messages.send<OP.ASSISTANT_SEND_MESSAGE>(OP.ASSISTANT_SEND_MESSAGE, message);
    },
    decide: decision => {
      if (decision.noteId !== this.note?.id) {
        throw new DOMException('Notebook changed', 'AbortError');
      }
      this.messages.send<OP.ASSISTANT_TOOL_DECISION>(OP.ASSISTANT_TOOL_DECISION, decision);
    },
    subscribe: listener => {
      const subscription = this.messages.receive(OP.ASSISTANT_EVENT).subscribe(listener);
      return () => subscription.unsubscribe();
    },
    subscribeClose: listener => {
      const subscription = this.messages.closed().subscribe(() => listener());
      return () => subscription.unsubscribe();
    }
  };

  private currentNote!: Exclude<Note['note'], undefined>;
  private destroy$ = new Subject<void>();
  private lastParagraphsKey = '';
  private panelWidth?: number;

  private assistantGeneration = 0;
  private destroyed = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private baseUrl: BaseUrlService,
    private ticket: TicketService,
    private slots: AssistantSlots,
    private reveal: AssistantReveal,
    private messages: MessageService,
    private proposals: AssistantProposals
  ) {}

  get note(): Exclude<Note['note'], undefined> {
    return this.currentNote;
  }

  /** The notebook reads the reactAssistant flag with the other React surface flags. */
  @Input() set enabled(enabled: boolean) {
    if (this.useAssistantPanel && !enabled) this.invalidateAssistant();
    // Turning it back on retries a remote that failed to load.
    if (!this.useAssistantPanel && enabled) this.assistantPanelFailed = false;
    this.useAssistantPanel = enabled;
  }

  @Input() set note(note: Exclude<Note['note'], undefined>) {
    if (this.currentNote?.id !== note?.id) {
      this.invalidateAssistant();
      this.assistantPanelFailed = false;
    }
    this.currentNote = note;
  }

  /** The notebook sidebar's width, which the panel shares. */
  @Input() set sidebarWidth(width: number) {
    this.panelWidth = width;
  }

  // Stable across prop rebuilds so the React panel does not re-report its visibility.
  readonly onPanelVisibilityChange = (visible: boolean): void => {
    this.slots.setPanelOpen(visible);
  };

  readonly subscribePanelClose = (listener: () => void): (() => void) => {
    const subscription = this.slots.panelCloseRequests.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  readonly onPanelWidthChange = (width: number): void => {
    this.panelWidthChange.emit(width);
  };

  readonly onAssistantError = (error: unknown): void => {
    console.error('React assistant panel error', error);
    this.assistantPanelFailed = true;
    this.cdr.markForCheck();
  };

  ngOnInit(): void {
    this.slots.slots.pipe(takeUntil(this.destroy$)).subscribe(() => {
      // Slots are registered during child view checks; publish once that pass finishes.
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.assistantProps = null;
        this.cdr.markForCheck();
      });
    });
  }

  // Paragraphs can be added, removed or retitled in place on the same note object, so they are compared each
  // check rather than only when `note` is set. The shared sidebar width follows the same way.
  ngDoCheck(): void {
    if (!this.currentNote) return;
    const paragraphs = (this.note.paragraphs ?? []).map(({ id, title }) => ({ id, title }));
    const paragraphsKey = JSON.stringify(paragraphs);
    if (!this.assistantProps) {
      this.assistantProps = this.buildAssistantProps(paragraphs);
    } else if (paragraphsKey !== this.lastParagraphsKey || this.assistantProps.panelWidth !== this.panelWidth) {
      this.assistantProps = { ...this.assistantProps, paragraphs, panelWidth: this.panelWidth };
    }
    this.lastParagraphsKey = paragraphsKey;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.invalidateAssistant();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private invalidateAssistant(): void {
    this.assistantGeneration++;
    this.assistantProps = null;
  }

  private buildAssistantProps(paragraphs: AssistantHostProps['paragraphs']): AssistantHostProps {
    const generation = this.assistantGeneration;
    return {
      noteId: this.note.id,
      // The remote calls the conversation REST API itself; auth failures come back through onAuthError.
      apiBase: this.baseUrl.getRestApiBase(),
      socket: this.assistantSocket,
      slots: this.slots.slots.value,
      draftOwner: this.ticket.ticket?.principal,
      onAuthError: (status, location) => {
        if (generation === this.assistantGeneration) {
          this.onAssistantAuthError(status, location);
        }
      },
      onError: error => {
        if (generation === this.assistantGeneration) {
          this.onAssistantError(error);
        }
      },
      revealParagraph: (paragraphId, options) =>
        generation === this.assistantGeneration
          ? this.reveal.reveal(paragraphId, options)
          : Promise.reject(new DOMException('Notebook changed', 'AbortError')),
      paragraphs,
      onPanelVisibilityChange: this.onPanelVisibilityChange,
      subscribePanelClose: this.subscribePanelClose,
      panelWidth: this.panelWidth,
      onPanelWidthChange: this.onPanelWidthChange,
      showProposal: proposal => {
        if (generation === this.assistantGeneration) this.proposals.show(proposal);
      },
      clearProposal: toolCallId => this.proposals.clear(toolCallId),
      subscribeProposalDecisions: listener => {
        const subscription = this.proposals.decisions.subscribe(({ toolCallId, decision }) =>
          listener(toolCallId, decision)
        );
        return () => subscription.unsubscribe();
      }
    };
  }

  private onAssistantAuthError(status: number, location: string | null): void {
    this.ticket.handleAuthFailure(status, location);
  }
}
