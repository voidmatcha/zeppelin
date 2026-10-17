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

import { InterpreterHealthVerdict, InterpreterHealthView, viewInterpreterHealth } from './interpreter-health';

/**
 * The health of one interpreter setting in the binding panel, at the right end of its row. The badge is the control: a
 * click checks again. A state that is not healthy says why in the row; the native title carries the check time.
 */
@Component({
  selector: 'zeppelin-notebook-interpreter-health-badge',
  templateUrl: './interpreter-health-badge.component.html',
  styleUrls: ['./interpreter-health-badge.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookInterpreterHealthBadgeComponent {
  /** The setting name, for the accessible name. */
  @Input() name = '';
  @Input() verdict?: InterpreterHealthVerdict;
  @Input() loading = false;
  /** Why the last check failed, if it did. */
  @Input() error?: string;
  @Output() readonly check = new EventEmitter<void>();

  get view(): InterpreterHealthView {
    return viewInterpreterHealth({ verdict: this.verdict, loading: this.loading, error: this.error });
  }

  get state(): InterpreterHealthView['state'] {
    return this.view.state;
  }

  /** The native title: when the answer shown was given (after a failure, the time of the last answer). */
  get title(): string | null {
    if (!this.verdict) {
      return null;
    }
    const time = formatDate(this.verdict.checkedAt, 'mediumTime', 'en-US');
    return this.state === 'failed' ? `Last result: ${this.view.lastLabel}, checked at ${time}` : `Checked at ${time}`;
  }

  get ariaLabel(): string {
    const { label, reason, lastLabel } = this.view;
    const last = this.state === 'failed' && lastLabel ? `, last result ${lastLabel}` : '';
    return `${this.name}: ${label}${reason ? `, ${reason}` : ''}${last}. Check again`;
  }

  onClick(): void {
    if (!this.loading) {
      this.check.emit();
    }
  }
}
