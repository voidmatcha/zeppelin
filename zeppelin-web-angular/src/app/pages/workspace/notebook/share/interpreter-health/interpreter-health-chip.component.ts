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
import { Subscription } from 'rxjs';

import { NzTooltipDirective } from 'ng-zorro-antd/tooltip';

import { InterpreterBindingItem } from '@zeppelin/sdk';

import {
  describeInterpreterGroups,
  InterpreterGroupDetail,
  InterpreterHealthVerdict,
  InterpreterHealthView,
  viewInterpreterHealth
} from './interpreter-health';
import { InterpreterHealthService } from './interpreter-health.service';

const MAX_LISTED_GROUPS = 3;

// A run is over when a paragraph goes from waiting or running to finished, error or aborted (a failure at once goes
// from ready to error).
const BEFORE_OVER_STATUSES = ['READY', 'PENDING', 'RUNNING'];
const OVER_STATUSES = ['FINISHED', 'ERROR', 'ABORT'];

/**
 * The health of the interpreter a paragraph runs on, at the bottom right of the paragraph: a dot, and in words what is wrong.
 * A click checks (the server never starts an interpreter for it), and so does the end of a run, in the background.
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
  /** The paragraph status: when a run is over, the health is refreshed. */
  @Input() status?: string;
  @ViewChild(NzTooltipDirective) tooltip?: NzTooltipDirective;

  verdict?: InterpreterHealthVerdict;
  loading = false;
  error?: string;
  private subscription?: Subscription;

  constructor(
    private healthService: InterpreterHealthService,
    private cdr: ChangeDetectorRef
  ) {}

  get view(): InterpreterHealthView {
    return viewInterpreterHealth({ verdict: this.verdict, loading: this.loading, error: this.error });
  }

  /** Healthy and checking are a dot; every other state is written out. */
  get showText(): boolean {
    return this.state !== 'healthy' && this.state !== 'checking';
  }

  get state(): InterpreterHealthView['state'] {
    return this.view.state;
  }

  get label(): string {
    return this.view.label;
  }

  /** What the last answer said, kept beside a failed check. */
  get lastLabel(): string | undefined {
    return this.view.lastLabel;
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
    const reason = this.view.reason ? ` (${this.view.reason})` : '';
    return `${this.interpreter?.name} interpreter: ${this.label}${reason}. Activate to check again`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    const { interpreter, status } = changes;
    if (interpreter && interpreter.previousValue?.id !== interpreter.currentValue?.id) {
      // A verdict belongs to one setting: when the paragraph moves to another one, read that one.
      this.subscription?.unsubscribe();
      this.subscription = this.interpreter
        ? this.healthService.entry$(this.interpreter.id).subscribe(entry => {
            this.verdict = entry.verdict;
            this.loading = entry.loading;
            this.error = entry.error;
            this.cdr.markForCheck();
          })
        : undefined;
    }
    if (
      status &&
      this.interpreter &&
      BEFORE_OVER_STATUSES.includes(status.previousValue) &&
      OVER_STATUSES.includes(status.currentValue)
    ) {
      this.healthService.check(this.interpreter.id, this.noteId, { background: true });
    }
  }

  check(): void {
    if (this.loading || !this.interpreter) {
      return;
    }
    this.tooltip?.hide();
    this.healthService.check(this.interpreter.id, this.noteId);
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
