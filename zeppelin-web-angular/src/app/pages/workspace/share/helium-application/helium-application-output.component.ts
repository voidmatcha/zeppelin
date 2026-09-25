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
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { HeliumApplicationState, OP, ParagraphItem } from '@zeppelin/sdk';
import { Subject, takeUntil } from 'rxjs';

import { HeliumApplicationRuntimeService } from '../../../../services/helium-application-runtime.service';
import { HeliumApplicationService } from '../../../../services/helium-application.service';
import { MessageService } from '../../../../services/message.service';

@Component({
  selector: 'zeppelin-helium-application-output',
  standalone: false,
  template: '@if (error) { <p role="alert">{{ error }}</p> } <div #output></div>'
})
export class HeliumApplicationOutputComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() noteId = '';
  @Input() paragraph!: ParagraphItem;
  @Input() app!: HeliumApplicationState;
  @ViewChild('output', { static: true }) output!: ElementRef<HTMLElement>;
  error = '';
  private handle?: ReturnType<HeliumApplicationRuntimeService['mount']>;
  private renderedOutput?: string;
  private readonly destroyed = new Subject<void>();

  constructor(
    private runtime: HeliumApplicationRuntimeService,
    private service: HeliumApplicationService,
    private messages: MessageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngAfterViewInit(): void {
    this.handle = this.runtime.mount(this.output.nativeElement, this.app.id, this.paragraph, change =>
      this.messages.send(OP.ANGULAR_OBJECT_UPDATED, change)
    );
    this.render();
    this.service.changes.pipe(takeUntil(this.destroyed)).subscribe(() => this.render());
    this.messages
      .receive(OP.ANGULAR_OBJECT_REMOVE)
      .pipe(takeUntil(this.destroyed))
      .subscribe(event => {
        if ((!event.noteId || event.noteId === this.noteId) && event.paragraphId === this.app.id) {
          this.handle?.removeObject(event);
        }
      });
  }

  ngOnChanges(): void {
    this.render();
  }

  private render(): void {
    if (!this.handle) {
      return;
    }
    try {
      for (const object of this.service.objects(this.noteId, this.app.id)) {
        this.handle.updateObject(object);
      }
      const output = this.app.output || '';
      if (output !== this.renderedOutput) {
        this.renderedOutput = output;
        this.error = '';
        this.handle.render(output);
      }
    } catch (error) {
      this.error = `Unable to render Helium application: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
    this.handle?.destroy();
  }
}
