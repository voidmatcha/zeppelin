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
  summarizeInterpreterHealth,
  summarizeInterpreterHealthReason
} from './interpreter-health';
import { InterpreterHealthService } from './interpreter-health.service';
import { interpreterLogoUrl } from './interpreter-logo';

type ChipState = 'healthy' | 'unhealthy' | 'starting' | 'not-running' | 'checking' | 'failed' | 'unknown';

const MAX_LISTED_GROUPS = 3;

// A run is over when a paragraph that was waiting or running is finished, failed or aborted. A paragraph that fails
// at once, for an interpreter it cannot find, goes from ready to error without being seen running.
const BEFORE_OVER_STATUSES = ['READY', 'PENDING', 'RUNNING'];
const OVER_STATUSES = ['FINISHED', 'ERROR', 'ABORT'];

/**
 * The health of the interpreter a paragraph runs on, at the bottom right of the paragraph. It shows the logo of
 * the interpreter and a dot and says what it found in a tooltip, because the chip has no text of its own. A click
 * checks (the server never starts an interpreter for it), and so does the end of a run, in the background. What is
 * found is shared with every other place that shows the same setting.
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
  /** The status of the paragraph: when a run is over, the health of its interpreter is refreshed. */
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

  get logoUrl(): string {
    return interpreterLogoUrl(this.interpreter?.name, this.replName);
  }

  get state(): ChipState {
    if (this.loading) {
      return 'checking';
    }
    if (this.error) {
      return 'failed';
    }
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).state : 'unknown';
  }

  get label(): string {
    if (this.error && !this.loading) {
      return 'Check failed';
    }
    return this.lastLabel ?? 'Not checked';
  }

  /** What the last answer said, which stays beside a failed check. */
  get lastLabel(): string | undefined {
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).label : undefined;
  }

  get reason(): string | undefined {
    if (this.error) {
      return this.error;
    }
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
    const { interpreter, status } = changes;
    if (interpreter && interpreter.previousValue?.id !== interpreter.currentValue?.id) {
      // A verdict belongs to one setting: when the paragraph moves to another one, it reads the entry of that one.
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
