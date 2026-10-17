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

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { InterpreterHealthVerdict, summarizeInterpreterHealth } from './interpreter-health';

type BadgeState = 'healthy' | 'unhealthy' | 'starting' | 'not-running' | 'checking' | 'unknown';

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
  @Output() readonly check = new EventEmitter<void>();

  get state(): BadgeState {
    if (this.loading) {
      return 'checking';
    }
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).state : 'unknown';
  }

  get label(): string {
    if (this.loading) {
      return 'Checking';
    }
    return this.verdict ? summarizeInterpreterHealth(this.verdict.health).label : 'Not checked';
  }

  get ariaLabel(): string {
    return `${this.name}: ${this.label}. Check again`;
  }

  onClick(): void {
    if (!this.loading) {
      this.check.emit();
    }
  }
}
