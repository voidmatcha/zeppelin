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

import { moveItemInArray, CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output
} from '@angular/core';
import { Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';

import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { InterpreterBindingItem } from '@zeppelin/sdk';
import { InterpreterService, MessageService } from '@zeppelin/services';

import {
  InterpreterHealthVerdict,
  interpreterHealthErrorMessage
} from '../share/interpreter-health/interpreter-health';

@Component({
  selector: 'zeppelin-notebook-interpreter-binding',
  templateUrl: './interpreter-binding.component.html',
  styleUrls: ['./interpreter-binding.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookInterpreterBindingComponent implements OnDestroy {
  private restarting = false;
  private readonly destroy$ = new Subject<void>();
  /** What the last check of each setting found, by setting id. */
  interpreterHealth: Record<string, InterpreterHealthVerdict | undefined> = {};
  checkingHealth: Record<string, boolean | undefined> = {};
  @Input() noteId!: string;
  @Input() interpreterBindings: InterpreterBindingItem[] = [];
  @Input() activatedExtension: 'interpreter' | 'permissions' | 'revisions' | 'hide' = 'hide';
  @Output() readonly activatedExtensionChange = new EventEmitter<
    'interpreter' | 'permissions' | 'revisions' | 'hide'
  >();

  restartInterpreter(interpreter: InterpreterBindingItem) {
    this.nzModalService.create({
      nzTitle: 'Restart interpreter',
      nzContent: `Do you want to restart ${interpreter.name} interpreter?`,
      nzOkLoading: this.restarting,
      nzOnOk: () =>
        new Promise(resolve => {
          this.restarting = true;
          this.interpreterService.restartInterpreter(interpreter.id, this.noteId).subscribe(
            _data => {
              this.restarting = false;
              this.cdr.markForCheck();
              resolve();
            },
            () => {
              this.restarting = false;
              resolve();
            }
          );
        })
    });
  }

  checkHealth(interpreter: InterpreterBindingItem) {
    if (this.checkingHealth[interpreter.id]) {
      return;
    }
    delete this.interpreterHealth[interpreter.id];
    this.checkingHealth[interpreter.id] = true;
    this.interpreterService
      .checkInterpreterHealth(interpreter.id, this.noteId)
      .pipe(
        finalize(() => {
          this.checkingHealth[interpreter.id] = false;
          this.cdr.markForCheck();
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: health => {
          this.interpreterHealth[interpreter.id] = { health, checkedAt: new Date() };
        },
        error: error => this.nzMessageService.error(interpreterHealthErrorMessage(error))
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  drop(event: CdkDragDrop<InterpreterBindingItem[]>) {
    moveItemInArray(this.interpreterBindings, event.previousIndex, event.currentIndex);
  }

  saveSetting() {
    const selectedSettingIds = this.interpreterBindings.filter(item => item.selected).map(item => item.id);
    this.messageService.saveInterpreterBindings(this.noteId, selectedSettingIds);
    this.messageService.getInterpreterBindings(this.noteId);
    this.closeSetting();
  }

  closeSetting() {
    this.activatedExtension = 'hide';
    this.activatedExtensionChange.emit('hide');
  }

  constructor(
    private nzModalService: NzModalService,
    private nzMessageService: NzMessageService,
    private interpreterService: InterpreterService,
    private cdr: ChangeDetectorRef,
    private messageService: MessageService
  ) {}
}
