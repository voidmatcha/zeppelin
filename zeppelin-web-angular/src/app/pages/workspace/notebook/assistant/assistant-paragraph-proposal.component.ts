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

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Optional,
  ViewChild
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import type { AssistantParagraphProposal, AssistantToolDecision } from '@zeppelin/sdk';
import { CodeEditorComponent } from '@zeppelin/share/code-editor/code-editor.component';
import type { DiffEditorOptions, EditorOptions } from '@zeppelin/share/code-editor/nz-code-editor.definitions';
import { AssistantProposals } from './assistant-proposals';

// Monaco's default line height for the notebook font, and room for the diff's own padding.
const LINE_HEIGHT_PX = 19;
const MAX_HEIGHT_PX = 420;

/** Lines only in `before` and only in `after`, counted as multisets: enough to say what changed in words. */
export const countChangedLines = (before: string, after: string): { removed: number; added: number } => {
  const remaining = new Map<string, number>();
  const beforeLines = before ? before.split('\n') : [];
  beforeLines.forEach(line => remaining.set(line, (remaining.get(line) ?? 0) + 1));
  let added = 0;
  for (const line of after ? after.split('\n') : []) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) remaining.set(line, left - 1);
    else added++;
  }
  const removed = Array.from(remaining.values()).reduce((sum, count) => sum + count, 0);
  return { removed, added };
};

/**
 * An assistant's proposed edit of this paragraph, as an inline Monaco diff above the editor with Allow and
 * Skip. Nothing changes here: the server applies an allowed edit and the paragraph updates as usual.
 */
@Component({
  selector: 'zeppelin-assistant-paragraph-proposal',
  templateUrl: './assistant-paragraph-proposal.component.html',
  styleUrls: ['./assistant-paragraph-proposal.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class AssistantParagraphProposalComponent implements OnInit, OnChanges, OnDestroy {
  @Input() paragraphId!: string;
  @Input() language?: string;

  proposal: AssistantParagraphProposal | null = null;
  // The code editor reads the model language from its options, in diff mode too.
  editorOption: DiffEditorOptions & Pick<EditorOptions, 'language'> = {};
  height = 0;
  /** What changed in words, so the diff is not told by colour alone. */
  summary = '';
  /** The paragraph was edited after the proposal arrived; Allow would overwrite that edit. */
  changedSinceProposed = false;
  private currentText = '';
  private proposedOver: string | null = null;
  private capped = false;
  private destroy$ = new Subject<void>();
  private resizeObserver?: ResizeObserver;
  private codeEditor?: CodeEditorComponent;

  constructor(
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>,
    @Optional() private proposals: AssistantProposals | null
  ) {}

  get text(): string {
    return this.currentText;
  }

  /** The paragraph's current text: the left side of the diff. A new paragraph has none yet. */
  @Input() set text(text: string | undefined) {
    this.currentText = text ?? '';
    this.update();
  }

  // Monaco lays out only on window resize; a new height, or the notebook narrowing when a sidebar opens, needs a
  // layout of its own.
  @ViewChild(CodeEditorComponent) set editor(editor: CodeEditorComponent | undefined) {
    this.codeEditor = editor;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (!editor || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.codeEditor?.layout());
    this.resizeObserver.observe(this.host.nativeElement);
  }

  ngOnInit(): void {
    this.proposals
      ?.forParagraph(this.paragraphId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(proposal => {
        // A new proposal is made against the text as it is now.
        if (proposal?.toolCallId !== this.proposal?.toolCallId) this.proposedOver = proposal ? this.text : null;
        this.proposal = proposal;
        this.update();
        this.cdr.markForCheck();
      });
  }

  ngOnChanges(): void {
    this.editorOption = this.options();
  }

  decide(decision: AssistantToolDecision['decision']): void {
    if (!this.proposal) return;
    // The proposal, and the button pressed, go away with the answer; keep keyboard focus on the paragraph.
    if (this.host.nativeElement.contains(document.activeElement)) {
      this.host.nativeElement.closest<HTMLElement>('zeppelin-notebook-paragraph')?.focus({ preventScroll: true });
    }
    this.proposals?.decide(this.proposal.toolCallId, decision);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Read-only inline diff that sizes to the paragraph; past the height cap it scrolls inside with the wheel.
  private options(): DiffEditorOptions & Pick<EditorOptions, 'language'> {
    return {
      readOnly: true,
      renderSideBySide: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      // Colour shows what changed, with the summary in words beside it; the +/- glyphs and revert arrows need
      // Monaco's icon font.
      renderIndicators: false,
      renderMarginRevertIcon: false,
      folding: false,
      originalAriaLabel: 'Current paragraph text',
      modifiedAriaLabel: 'Suggested paragraph text',
      scrollbar: { handleMouseWheel: this.capped, alwaysConsumeMouseWheel: false },
      language: this.language
    };
  }

  // Both sides of the inline diff, so it sizes to the paragraph instead of scrolling inside it.
  private update(): void {
    const lines = (this.text.match(/\n/g)?.length ?? 0) + (this.proposal?.text.match(/\n/g)?.length ?? 0) + 2;
    const height = lines * LINE_HEIGHT_PX + 8;
    this.height = Math.min(MAX_HEIGHT_PX, height);
    const capped = height > MAX_HEIGHT_PX;
    if (capped !== this.capped) {
      this.capped = capped;
      this.editorOption = this.options();
    }
    this.changedSinceProposed = this.proposedOver !== null && this.text !== this.proposedOver;
    const { removed, added } = countChangedLines(this.text, this.proposal?.text ?? '');
    const lineCount = (count: number) => `${count} ${count === 1 ? 'line' : 'lines'}`;
    this.summary = this.proposal ? `${lineCount(removed)} removed, ${lineCount(added)} added` : '';
  }
}
