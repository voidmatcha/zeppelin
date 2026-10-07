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

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import type { AssistantParagraphProposal, AssistantToolDecision } from '@zeppelin/sdk';

export interface AssistantProposalDecision {
  toolCallId: string;
  decision: AssistantToolDecision['decision'];
}

/**
 * Paragraph edits the assistant proposed and is waiting on, keyed by paragraph. The React panel owns the
 * approval; this only carries proposals into the paragraphs and decisions made there back to the panel.
 */
@Injectable()
export class AssistantProposals {
  readonly decisions = new Subject<AssistantProposalDecision>();
  private readonly proposals = new BehaviorSubject<AssistantParagraphProposal[]>([]);

  show(proposal: AssistantParagraphProposal): void {
    this.proposals.next([...this.proposals.value.filter(item => item.toolCallId !== proposal.toolCallId), proposal]);
  }

  clear(toolCallId: string): void {
    if (this.proposals.value.some(item => item.toolCallId === toolCallId)) {
      this.proposals.next(this.proposals.value.filter(item => item.toolCallId !== toolCallId));
    }
  }

  /** The latest proposal for a paragraph, or null. */
  forParagraph(paragraphId: string): Observable<AssistantParagraphProposal | null> {
    return this.proposals.pipe(
      map(items => [...items].reverse().find(item => item.paragraphId === paragraphId) ?? null),
      distinctUntilChanged()
    );
  }

  decide(toolCallId: string, decision: AssistantToolDecision['decision']): void {
    this.decisions.next({ toolCallId, decision });
  }
}
