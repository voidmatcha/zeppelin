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

import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeDetectorRef, ElementRef } from '@angular/core';
import type { AssistantParagraphProposal } from '@zeppelin/sdk';
import type { AssistantProposals } from './assistant-proposals';
import { AssistantParagraphProposalComponent, countChangedLines } from './assistant-paragraph-proposal.component';

describe('countChangedLines', () => {
  it('counts lines only on one side, so the summary says what the colours show', () => {
    expect(countChangedLines('a\nb\nc', 'a\nB\nc\nd')).toEqual({ removed: 1, added: 2 });
    expect(countChangedLines('', 'print(1)')).toEqual({ removed: 0, added: 1 });
    expect(countChangedLines('x\nx', 'x')).toEqual({ removed: 1, added: 0 });
    expect(countChangedLines('same', 'same')).toEqual({ removed: 0, added: 0 });
  });
});

describe('AssistantParagraphProposalComponent', () => {
  it('warns once the paragraph changes after the suggestion arrived, since Allow would replace that edit', () => {
    const proposal = new BehaviorSubject<AssistantParagraphProposal | null>(null);
    const component = new AssistantParagraphProposalComponent(
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      { nativeElement: document.createElement('div') } as ElementRef<HTMLElement>,
      { forParagraph: () => proposal, decide: vi.fn() } as unknown as AssistantProposals
    );
    component.paragraphId = 'p1';
    component.text = 'print(1)';
    component.ngOnInit();

    proposal.next({ toolCallId: 't1', paragraphId: 'p1', text: 'print(2)' });
    expect(component.changedSinceProposed).toBe(false);
    component.text = 'print(10)';
    expect(component.changedSinceProposed).toBe(true);
    component.text = 'print(1)';
    expect(component.changedSinceProposed).toBe(false);

    // A new suggestion is made against the text as it is then.
    component.text = 'print(10)';
    proposal.next({ toolCallId: 't2', paragraphId: 'p1', text: 'print(3)' });
    expect(component.changedSinceProposed).toBe(false);
    component.ngOnDestroy();
  });
});
