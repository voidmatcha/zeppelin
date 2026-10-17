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
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';

import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTooltipDirective } from 'ng-zorro-antd/tooltip';

import { InterpreterBindingItem } from '@zeppelin/sdk';
import { InterpreterService } from '@zeppelin/services';

import {
  describeInterpreterGroups,
  InterpreterGroupDetail,
  InterpreterHealthVerdict,
  interpreterHealthErrorMessage,
  summarizeInterpreterHealth,
  summarizeInterpreterHealthReason
} from './interpreter-health';
import { interpreterLogoUrl } from './interpreter-logo';

type ChipState = 'healthy' | 'unhealthy' | 'starting' | 'not-running' | 'checking' | 'unknown';

const MAX_LISTED_GROUPS = 3;

/**
 * The health of the interpreter a paragraph runs on, at the bottom right of the paragraph. It shows the logo of
 * the interpreter and a dot, checks on a click only (the server never starts an interpreter for it) and says what
 * it found in a tooltip, because the chip has no text of its own.
 */
@Component({
  selector: 'zeppelin-notebook-interpreter-health-chip',
  templateUrl: './interpreter-health-chip.component.html',
  styleUrls: ['./interpreter-health-chip.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookInterpreterHealthChipComponent implements OnChanges, OnDestroy {
  @Input() interpreter!: InterpreterBindingItem;
  @Input() noteId!: string;
  /** The `%name` of the paragraph, a fallback for choosing the logo. */
  @Input() replName?: string;
  @ViewChild(NzTooltipDirective) tooltip?: NzTooltipDirective;

  verdict?: InterpreterHealthVerdict;
  loading = false;
  private readonly destroy$ = new Subject<void>();
  private cancel$ = new Subject<void>();

  get logoUrl(): string {
    return interpreterLogoUrl(this.interpreter?.name, this.replName);
  }

  get state(): ChipState {
    if (this.loading) {
      return 'checking';
    }
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).state : 'unknown';
  }

  get label(): string {
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).label : 'Not checked';
  }

  get reason(): string | undefined {
    return this.verdict ? summarizeInterpreterHealthReason(this.verdict.health) : undefined;
  }

  get groups(): InterpreterGroupDetail[] {
    return this.verdict ? describeInterpreterGroups(this.verdict.health) : [];
  }

  get listedGroups(): InterpreterGroupDetail[] {
    return this.state === 'unhealthy' ? this.groups.slice(0, MAX_LISTED_GROUPS) : [];
  }

  get hiddenGroupCount(): number {
    return this.state === 'unhealthy' ? Math.max(0, this.groups.length - MAX_LISTED_GROUPS) : 0;
  }

  get ariaLabel(): string {
    const reason = this.reason ? ` (${this.reason})` : '';
    return `${this.interpreter?.name} interpreter: ${this.label}${reason}. Activate to check again`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes.interpreter;
    if (change && change.previousValue?.id !== change.currentValue?.id) {
      // A verdict belongs to one setting: when the paragraph moves to another one, the old answer is void.
      this.cancel$.next();
      this.verdict = undefined;
      this.loading = false;
    }
  }

  check(): void {
    if (this.loading || !this.interpreter) {
      return;
    }
    this.verdict = undefined;
    this.loading = true;
    this.tooltip?.hide();
    this.interpreterService
      .checkInterpreterHealth(this.interpreter.id, this.noteId)
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        }),
        takeUntil(this.cancel$),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: health => {
          this.verdict = { health, checkedAt: new Date() };
        },
        error: error => this.nzMessageService.error(interpreterHealthErrorMessage(error))
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  constructor(
    private interpreterService: InterpreterService,
    private nzMessageService: NzMessageService,
    private cdr: ChangeDetectorRef
  ) {}
}
