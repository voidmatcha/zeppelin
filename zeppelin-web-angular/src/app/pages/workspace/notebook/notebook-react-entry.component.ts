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

import { ChangeDetectorRef, Component, HostBinding, Input, OnDestroy } from '@angular/core';

import { NotebookCorePort } from '@zeppelin/notebook-core';

import { NotebookCoreReadHost } from './notebook-core-read-host';

@Component({
  selector: 'zeppelin-notebook-react-entry',
  template:
    '<div data-testid="react-notebook-host" zeppelin-react-mount="./NotebookRouteEntry" [reactProps]="reactProps"></div>',
  standalone: false
})
export class NotebookReactEntryComponent implements OnDestroy {
  @Input({ required: true }) onEntryFailure!: () => void;
  @HostBinding('attr.data-read-ready') ready = false;

  reactProps: Record<string, unknown> = {};
  private isEditable = false;
  private currentHost?: NotebookCoreReadHost;
  private port?: NotebookCorePort;
  private unsubscribe?: () => void;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  @Input() set editable(value: boolean) {
    this.isEditable = value;
    this.updateReactProps();
    this.cdr.markForCheck();
  }

  @Input({ required: true }) set host(value: NotebookCoreReadHost) {
    this.unsubscribe?.();
    this.currentHost = value;
    this.port = value.port;
    this.ready = false;
    this.cdr.markForCheck();
    this.unsubscribe = value.port.subscribe(() => {
      const state = value.port.getSnapshot().readState;
      if (state?.status !== 'ready' || state.acl.status !== 'ready') {
        this.ready = false;
        this.cdr.markForCheck();
      }
    });
    this.updateReactProps();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.currentHost = undefined;
    this.port = undefined;
    this.ready = false;
  }

  private updateReactProps(): void {
    const value = this.currentHost;
    if (!value) {
      return;
    }
    this.reactProps = {
      core: value.port,
      ...(this.isEditable ? { commandPort: value.commandPort } : {}),
      onError: this.onError,
      onReady: () => {
        const state = value.port.getSnapshot().readState;
        if (this.port === value.port && state?.status === 'ready' && state.acl.status === 'ready') {
          this.ready = true;
          this.cdr.markForCheck();
        }
      }
    };
  }

  private readonly onError = (_error: unknown): void => this.onEntryFailure();
}
