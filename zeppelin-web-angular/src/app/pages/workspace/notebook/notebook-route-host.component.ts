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

import { Component, OnDestroy, OnInit, ViewChild, ViewContainerRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

import { MessageService, ReactFeatureService, SecurityService } from '@zeppelin/services';
import { NotebookComponent } from './notebook.component';
import { NotebookCoreReadComponent } from './notebook-core-read.component';
import { NotebookCoreReadHost } from './notebook-core-read-host';
import { NotebookReactEntryComponent } from './notebook-react-entry.component';

type NotebookRouteMode = 'editable' | 'angular-read' | 'react-read' | 'angular-edit' | 'react-edit' | 'fallback';

@Component({
  selector: 'zeppelin-notebook-route-host',
  template: '<ng-container #outlet></ng-container>',
  standalone: false
})
export class NotebookRouteHostComponent implements OnInit, OnDestroy {
  @ViewChild('outlet', { read: ViewContainerRef, static: true }) private outlet!: ViewContainerRef;
  private readonly subscriptions = new Subscription();
  private readHost?: NotebookCoreReadHost;
  private readSubscription?: Subscription;
  private mode: NotebookRouteMode = 'editable';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly features: ReactFeatureService,
    private readonly message: MessageService,
    private readonly security: SecurityService
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.queryParamMap
        .pipe(
          map(params =>
            this.features.isEnabled('notebookReactEditPrivate', params)
              ? 'react-edit'
              : this.features.isEnabled('notebookCoreEditPrivate', params)
                ? 'angular-edit'
                : this.features.isEnabled('notebookReactPrivate', params)
                  ? 'react-read'
                  : this.features.isEnabled('notebookCoreReadOnly', params)
                    ? 'angular-read'
                    : 'editable'
          ),
          distinctUntilChanged()
        )
        .subscribe(mode => {
          this.mode = mode;
          this.outlet.clear();
          this.readSubscription?.unsubscribe();
          this.readHost?.destroy();
          this.readHost = undefined;
          if (mode === 'editable') {
            this.outlet.createComponent(NotebookComponent);
            return;
          }

          const host = new NotebookCoreReadHost(this.message, this.security);
          this.readHost = host;
          this.readSubscription = combineLatest([
            this.message.connectedStatus$.pipe(startWith(this.message.connectedStatus), distinctUntilChanged()),
            this.route.paramMap.pipe(
              map(params => ({ noteId: params.get('noteId'), revisionId: params.get('revisionId') })),
              distinctUntilChanged(
                (left, right) => left.noteId === right.noteId && left.revisionId === right.revisionId
              )
            )
          ]).subscribe(([connected, target]) => {
            if (!connected) {
              host.invalidate();
            } else if (target.noteId) {
              host.load(target.noteId, target.revisionId);
            }
          });

          if (mode === 'react-read' || mode === 'react-edit') {
            const entry = this.outlet.createComponent(NotebookReactEntryComponent);
            entry.setInput('editable', mode === 'react-edit');
            entry.setInput('host', host);
            entry.setInput('onEntryFailure', () => this.fallbackToAngular(host));
          } else {
            const entry = this.outlet.createComponent(NotebookCoreReadComponent);
            entry.setInput('host', host);
            entry.setInput('editable', mode === 'angular-edit');
          }
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.readSubscription?.unsubscribe();
    this.outlet.clear();
    this.readHost?.destroy();
  }

  private fallbackToAngular(host: NotebookCoreReadHost): void {
    if (this.readHost !== host || (this.mode !== 'react-read' && this.mode !== 'react-edit')) {
      return;
    }
    const editable = this.mode === 'react-edit';
    this.mode = 'fallback';
    this.outlet.clear();
    const entry = this.outlet.createComponent(NotebookCoreReadComponent);
    entry.setInput('host', host);
    entry.setInput('editable', editable);
  }
}
