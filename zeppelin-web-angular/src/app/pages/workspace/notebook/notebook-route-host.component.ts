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
import { Subscription } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { MessageService, ReactFeatureService, SecurityService } from '@zeppelin/services';
import { NotebookComponent } from './notebook.component';
import { NotebookCoreReadComponent } from './notebook-core-read.component';
import { NotebookCoreReadHost } from './notebook-core-read-host';

@Component({
  selector: 'zeppelin-notebook-route-host',
  template: '<ng-container #outlet></ng-container>',
  standalone: false
})
export class NotebookRouteHostComponent implements OnInit, OnDestroy {
  @ViewChild('outlet', { read: ViewContainerRef, static: true }) private outlet!: ViewContainerRef;
  private readonly subscriptions = new Subscription();
  private readHost?: NotebookCoreReadHost;

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
          map(params => this.features.isEnabled('notebookCoreReadOnly', params)),
          distinctUntilChanged()
        )
        .subscribe(readOnly => {
          // Clearing destroys the legacy note before the private view can subscribe or request.
          this.outlet.clear();
          this.readHost?.destroy();
          this.readHost = undefined;
          if (readOnly) {
            this.readHost = new NotebookCoreReadHost(this.message, this.security);
            this.outlet.createComponent(NotebookCoreReadComponent).setInput('host', this.readHost);
          } else {
            this.outlet.createComponent(NotebookComponent);
          }
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.outlet.clear();
    this.readHost?.destroy();
  }
}
