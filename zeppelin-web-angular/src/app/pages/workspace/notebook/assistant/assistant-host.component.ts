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

import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Note, OP, type AssistantSocket } from '@zeppelin/sdk';
import { BaseUrlService, MessageService, TicketService } from '@zeppelin/services';
import { AssistantSlots } from './assistant-slots';

@Component({
  selector: 'zeppelin-assistant-host',
  template: `
    @if (useAssistantPanel) {
      @if (assistantPanelFailed) {
        <p role="alert">Unable to load the assistant.</p>
      } @else {
        <div zeppelin-react-mount="./AssistantWorkspace" [reactProps]="assistantProps"></div>
      }
    }
  `,
  standalone: false
})
export class AssistantHostComponent implements OnInit, OnDestroy {
  useAssistantPanel = false;
  assistantPanelFailed = false;
  private currentNote!: Exclude<Note['note'], undefined>;
  private destroy$ = new Subject<void>();
  private lastAssistantProps: Record<string, unknown> | null = null;

  private assistantGeneration = 0;
  private destroyed = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private baseUrl: BaseUrlService,
    private ticket: TicketService,
    private slots: AssistantSlots,
    private messages: MessageService
  ) {}

  get note(): Exclude<Note['note'], undefined> {
    return this.currentNote;
  }
  get assistantProps(): Record<string, unknown> {
    if (!this.lastAssistantProps) {
      const generation = this.assistantGeneration;
      const noteId = this.note.id;
      this.lastAssistantProps = {
        noteId,
        // The remote calls the conversation REST API itself; auth failures come back through onAuthError.
        apiBase: this.baseUrl.getRestApiBase(),
        socket: this.assistantSocket,
        slots: this.slots.slots.value,
        draftOwner: this.ticket.ticket?.principal,
        onAuthError: (status: number, location: string | null) => {
          if (generation === this.assistantGeneration) {
            this.onAssistantAuthError(status, location);
          }
        },
        onError: (error: unknown) => {
          if (generation === this.assistantGeneration) {
            this.onAssistantError(error);
          }
        },
        onPanelVisibilityChange: this.onPanelVisibilityChange,
        subscribePanelClose: this.subscribePanelClose
      };
    }
    return this.lastAssistantProps;
  }

  /** The notebook reads the reactAssistant flag with the other React surface flags. */
  @Input() set enabled(enabled: boolean) {
    if (this.useAssistantPanel && !enabled) this.invalidateAssistant();
    // Turning the flag back on retries a remote that failed to load.
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

  // Sending and run events share the notebook WebSocket, which Angular owns.
  readonly assistantSocket: AssistantSocket = {
    send: message => {
      if (message.noteId !== this.note?.id) {
        throw new DOMException('Notebook changed', 'AbortError');
      }
      this.messages.send<OP.ASSISTANT_SEND_MESSAGE>(OP.ASSISTANT_SEND_MESSAGE, message);
    },
    subscribe: listener => {
      const subscription = this.messages.receive(OP.ASSISTANT_EVENT).subscribe(listener);
      return () => subscription.unsubscribe();
    }
  };

  // Stable across prop rebuilds so the React panel does not re-report its visibility.
  readonly onPanelVisibilityChange = (visible: boolean): void => {
    this.slots.setPanelOpen(visible);
  };

  readonly subscribePanelClose = (listener: () => void): (() => void) => {
    const subscription = this.slots.panelCloseRequests.subscribe(listener);
    return () => subscription.unsubscribe();
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
        this.lastAssistantProps = null;
        this.cdr.markForCheck();
      });
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.invalidateAssistant();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private invalidateAssistant(): void {
    this.assistantGeneration++;
    this.lastAssistantProps = null;
  }

  private onAssistantAuthError(status: number, location: string | null): void {
    this.ticket.handleAuthFailure(status, location);
  }
}
