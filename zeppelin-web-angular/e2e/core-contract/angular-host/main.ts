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

import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Injectable, NgModule } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BrowserModule } from '@angular/platform-browser';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { ActivatedRoute, RouterModule, UrlMatcher } from '@angular/router';
import { ReactMountDirective } from '@zeppelin/share/react-mount';
import type { NotebookCorePort, NotebookCoreSnapshot } from '@zeppelin/notebook-core';

declare global {
  interface Window {
    __zeppelinNotebookCorePortProof?: {
      hostCore: NotebookCorePort;
      proofs: unknown[];
      receivedCore?: NotebookCorePort;
    };
    __zeppelinNotebookRouteBoundaryProof?: {
      hostCore: NotebookCorePort;
      proofs: unknown[];
      receivedCore?: NotebookCorePort;
      receivedCores: NotebookCorePort[];
    };
  }
}

@Component({
  selector: 'zeppelin-notebook-core-port-proof-app',
  standalone: false,
  template: '<router-outlet></router-outlet>'
})
export class NotebookCorePortProofAppComponent {}

@Component({
  selector: 'zeppelin-notebook-core-port-proof',
  standalone: false,
  template: `
    <button type="button" data-testid="publish-notebook-core-revision" (click)="publishRevision()">
      publish revision
    </button>
    <div [zeppelin-react-mount]="'./NotebookCorePortProbe'" [reactProps]="reactProps"></div>
  `
})
export class NotebookCorePortProofComponent {
  readonly core: NotebookCorePort = Object.freeze({
    getSnapshot: () => this.snapshot,
    subscribe: listener => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  });

  readonly reactProps = {
    core: this.core,
    expectedCore: this.core,
    onProof: (proof: unknown) => {
      window.__zeppelinNotebookCorePortProof?.proofs.push(proof);
    },
    onReceivedCore: (receivedCore: NotebookCorePort) => {
      window.__zeppelinNotebookCorePortProof = window.__zeppelinNotebookCorePortProof ?? {
        hostCore: this.core,
        proofs: []
      };
      window.__zeppelinNotebookCorePortProof.receivedCore = receivedCore;
    }
  };

  private snapshot: NotebookCoreSnapshot = { noteId: 'note-host-owned', revisionId: null };
  private readonly listeners = new Set<() => void>();

  constructor() {
    window.__zeppelinNotebookCorePortProof = {
      hostCore: this.core,
      proofs: []
    };
  }

  publishRevision(): void {
    this.snapshot = { noteId: 'note-host-owned', revisionId: 'revision-from-angular-host' };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

@Injectable({ providedIn: 'root' })
export class NotebookRouteBoundaryPortHost {
  readonly core: NotebookCorePort = Object.freeze({
    getSnapshot: () => this.snapshot,
    subscribe: listener => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  });

  private snapshot: NotebookCoreSnapshot = { noteId: '', revisionId: null };
  private readonly listeners = new Set<() => void>();

  publish(snapshot: NotebookCoreSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

@Component({
  selector: 'zeppelin-notebook-route-boundary-proof',
  standalone: false,
  template: `
    <button type="button" data-testid="navigate-notebook-note" [routerLink]="['/notebook', 'note-route-updated']">
      navigate note
    </button>
    <button
      type="button"
      data-testid="navigate-notebook-revision"
      [routerLink]="['/notebook', 'note-route-updated', 'revision', 'revision-from-route']"
    >
      navigate revision
    </button>
    <div [zeppelin-react-mount]="'./NotebookRouteBoundaryProbe'" [reactProps]="reactProps"></div>
  `
})
export class NotebookRouteBoundaryProofComponent {
  readonly core: NotebookCorePort;
  readonly reactProps: Readonly<{
    core: NotebookCorePort;
    expectedCore: NotebookCorePort;
    onProof: (proof: unknown) => void;
    onReceivedCore: (receivedCore: NotebookCorePort) => void;
  }>;

  constructor(activatedRoute: ActivatedRoute, destroyRef: DestroyRef, portHost: NotebookRouteBoundaryPortHost) {
    this.core = portHost.core;
    this.reactProps = {
      core: this.core,
      expectedCore: this.core,
      onProof: (proof: unknown) => {
        window.__zeppelinNotebookRouteBoundaryProof?.proofs.push(proof);
      },
      onReceivedCore: (receivedCore: NotebookCorePort) => {
        const proofState = window.__zeppelinNotebookRouteBoundaryProof;
        if (proofState) {
          proofState.receivedCore = receivedCore;
          proofState.receivedCores.push(receivedCore);
        }
      }
    };

    window.__zeppelinNotebookRouteBoundaryProof = window.__zeppelinNotebookRouteBoundaryProof ?? {
      hostCore: this.core,
      proofs: [],
      receivedCores: []
    };

    activatedRoute.paramMap.pipe(takeUntilDestroyed(destroyRef)).subscribe(params => {
      portHost.publish({
        noteId: params.get('noteId') ?? '',
        revisionId: params.get('revisionId')
      });
    });
  }
}

const notebookRouteMatcher: UrlMatcher = segments => {
  if (segments[0]?.path !== 'notebook' || (segments.length !== 2 && segments.length !== 4)) {
    return null;
  }
  if (segments.length === 4 && segments[2]?.path !== 'revision') {
    return null;
  }
  return {
    consumed: segments,
    posParams: {
      noteId: segments[1],
      ...(segments[3] ? { revisionId: segments[3] } : {})
    }
  };
};

@NgModule({
  bootstrap: [NotebookCorePortProofAppComponent],
  declarations: [
    NotebookCorePortProofAppComponent,
    NotebookCorePortProofComponent,
    NotebookRouteBoundaryProofComponent,
    ReactMountDirective
  ],
  imports: [
    BrowserModule,
    CommonModule,
    RouterModule.forRoot([
      { path: 'port-identity', component: NotebookCorePortProofComponent },
      { matcher: notebookRouteMatcher, component: NotebookRouteBoundaryProofComponent },
      { path: '**', redirectTo: 'port-identity' }
    ])
  ]
})
export class NotebookCorePortProofModule {}

void platformBrowserDynamic().bootstrapModule(NotebookCorePortProofModule);
