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

import { formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import {
  InterpreterHealthVerdict,
  summarizeInterpreterHealth,
  summarizeInterpreterHealthReason
} from './interpreter-health';

type BadgeState = 'healthy' | 'unhealthy' | 'starting' | 'not-running' | 'checking' | 'failed' | 'unknown';

/**
 * The health of one interpreter setting in the note's interpreter binding panel, at the right end of its row. The
 * badge is the control: a click checks again. A state that is not healthy says why in the row, so the reason is
 * visible without hovering; the check time is the native title.
 */
@Component({
  selector: 'zeppelin-notebook-interpreter-health-badge',
  templateUrl: './interpreter-health-badge.component.html',
  styleUrls: ['./interpreter-health-badge.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookInterpreterHealthBadgeComponent {
  /** The name of the interpreter setting, for the accessible name. */
  @Input() name = '';
  @Input() verdict?: InterpreterHealthVerdict;
  @Input() loading = false;
  /** Why the last check failed, if it did. */
  @Input() error?: string;
  @Output() readonly check = new EventEmitter<void>();

  get state(): BadgeState {
    if (this.loading) {
      return 'checking';
    }
    if (this.error) {
      return 'failed';
    }
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).state : 'unknown';
  }

  get label(): string {
    if (this.loading) {
      return 'Checking';
    }
    if (this.error) {
      return 'Check failed';
    }
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).label : 'Not checked';
  }

  get reason(): string | undefined {
    if (this.loading) {
      return undefined;
    }
    if (this.error) {
      return this.error;
    }
    return this.verdict ? summarizeInterpreterHealthReason(this.verdict.health) : undefined;
  }

  /** What the last answer said, which stays in view beside a failed check. */
  get lastLabel(): string | undefined {
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).label : undefined;
  }

  /** What the badge says: the state, and after a bar why, written as one text so that it reads the same to everyone. */
  get text(): string {
    const last = this.state === 'failed' && this.lastLabel ? ` (last: ${this.lastLabel})` : '';
    return this.reason ? `${this.label} | ${this.reason}${last}` : this.label;
  }

  /** The native title: when the answer shown was given. After a failure it is the time of the last answer, said so. */
  get title(): string | null {
    if (!this.verdict) {
      return null;
    }
    const time = formatDate(this.verdict.checkedAt, 'mediumTime', 'en-US');
    return this.state === 'failed' ? `Last result: ${this.lastLabel}, checked at ${time}` : `Checked at ${time}`;
  }

  get ariaLabel(): string {
    const reason = this.reason ? `, ${this.reason}` : '';
    const last = this.state === 'failed' && this.lastLabel ? `, last result ${this.lastLabel}` : '';
    return `${this.name}: ${this.label}${reason}${last}. Check again`;
  }

  onClick(): void {
    if (!this.loading) {
      this.check.emit();
    }
  }
}
