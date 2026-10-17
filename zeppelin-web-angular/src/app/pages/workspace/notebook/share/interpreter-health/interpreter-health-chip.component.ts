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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input } from '@angular/core';
import { finalize } from 'rxjs/operators';

import { NzMessageService } from 'ng-zorro-antd/message';

import { InterpreterBindingItem } from '@zeppelin/sdk';
import { InterpreterService } from '@zeppelin/services';

import {
  InterpreterHealthVerdict,
  interpreterHealthErrorMessage,
  summarizeInterpreterHealth
} from './interpreter-health';
import { interpreterLogoUrl } from './interpreter-logo';

type ChipState = 'healthy' | 'unhealthy' | 'starting' | 'not-running' | 'checking' | 'unknown';

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
export class NotebookInterpreterHealthChipComponent {
  @Input() interpreter!: InterpreterBindingItem;
  @Input() noteId!: string;
  /** The `%name` of the paragraph, a fallback for choosing the logo. */
  @Input() replName?: string;

  verdict?: InterpreterHealthVerdict;
  loading = false;

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

  get ariaLabel(): string {
    return `${this.interpreter?.name} interpreter: ${this.label}. Activate to check again`;
  }

  check(): void {
    if (this.loading || !this.interpreter) {
      return;
    }
    this.verdict = undefined;
    this.loading = true;
    this.interpreterService
      .checkInterpreterHealth(this.interpreter.id, this.noteId)
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: health => {
          this.verdict = { health, checkedAt: new Date() };
        },
        error: error => this.nzMessageService.error(interpreterHealthErrorMessage(error))
      });
  }

  constructor(
    private interpreterService: InterpreterService,
    private nzMessageService: NzMessageService,
    private cdr: ChangeDetectorRef
  ) {}
}
