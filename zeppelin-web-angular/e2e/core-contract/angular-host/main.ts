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
import { ChangeDetectorRef, Component, DestroyRef, Injectable, NgModule } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BrowserModule } from '@angular/platform-browser';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { ActivatedRoute, RouterModule, UrlMatcher } from '@angular/router';
import { createNotebookCore, type NotebookCorePort, type NotebookCoreSnapshot } from '@zeppelin/notebook-core';
import { ReactMountDirective } from '@zeppelin/share/react-mount';
import { Observable } from 'rxjs';

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
  private readonly runtime = createNotebookCore({ noteId: 'note-host-owned', revisionId: null });
  readonly core: NotebookCorePort = this.runtime.port;

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

  constructor() {
    window.__zeppelinNotebookCorePortProof = {
      hostCore: this.core,
      proofs: []
    };
  }

  publishRevision(): void {
    this.runtime.apply({
      type: 'route-changed',
      noteId: 'note-host-owned',
      revisionId: 'revision-from-angular-host'
    });
  }
}

@Injectable({ providedIn: 'root' })
export class NotebookRouteBoundaryPortHost {
  private readonly runtime = createNotebookCore();
  readonly core: NotebookCorePort = this.runtime.port;
  readonly snapshot$ = new Observable<NotebookCoreSnapshot>(subscriber => {
    subscriber.next(this.core.getSnapshot());
    return this.core.subscribe(() => subscriber.next(this.core.getSnapshot()));
  });

  enterRoute(noteId: string, revisionId: string | null): void {
    this.runtime.apply({ type: 'route-changed', noteId, revisionId });
    this.runtime.apply({ type: 'load-started' });
  }

  loadFixtureForRoute(noteId: string, revisionId: string | null): void {
    this.runtime.apply({
      type: 'note-loaded',
      noteId,
      revisionId,
      title: `Fixture ${noteId}`,
      paragraphs: [
        { id: 'paragraph-1', text: '%md shared state', status: 'FINISHED' },
        { id: 'paragraph-2', text: '%spark 1 + 1', status: 'READY' }
      ]
    });
  }

  applyParagraphAdded(index: number): void {
    this.runtime.apply({
      type: 'paragraph-added',
      index,
      paragraph: { id: 'paragraph-incremental', text: '%md incremental state', status: 'READY' }
    });
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
    <button type="button" data-testid="load-notebook-fixture" (click)="loadFixture()">load fixture</button>
    <button type="button" data-testid="load-stale-notebook-fixture" (click)="loadStaleFixture()">
      load stale fixture
    </button>
    <button type="button" data-testid="apply-notebook-mutation" (click)="applyMutation()">apply mutation</button>
    @if (snapshot$ | async; as snapshot) {
      <section
        data-testid="notebook-angular-adapter"
        [attr.data-note-id]="snapshot.noteId"
        [attr.data-revision-id]="snapshot.revisionId ?? ''"
        [attr.data-phase]="snapshot.phase"
        [attr.data-title]="snapshot.title ?? ''"
        [attr.data-paragraph-count]="snapshot.paragraphs.length"
        [attr.data-version]="snapshot.version"
      >
        {{ snapshot.title ?? snapshot.noteId }}
      </section>
      @if (reactFailed) {
        <section
          data-testid="notebook-angular-fallback"
          [attr.data-note-id]="snapshot.noteId"
          [attr.data-phase]="snapshot.phase"
          [attr.data-title]="snapshot.title ?? ''"
          [attr.data-paragraph-count]="snapshot.paragraphs.length"
          [attr.data-version]="snapshot.version"
        >
          Angular fallback: {{ snapshot.title ?? snapshot.noteId }}
        </section>
      }
    }
    @if (!reactFailed) {
      <div [zeppelin-react-mount]="reactModule" [reactProps]="reactProps"></div>
    }
  `
})
export class NotebookRouteBoundaryProofComponent {
  readonly core: NotebookCorePort;
  readonly snapshot$: Observable<NotebookCoreSnapshot>;
  readonly reactModule: string;
  readonly reactProps: Readonly<{
    core: NotebookCorePort;
    expectedCore: NotebookCorePort;
    onProof: (proof: unknown) => void;
    onReceivedCore: (receivedCore: NotebookCorePort) => void;
    onReady: () => void;
    onError: (error: unknown) => void;
  }>;
  reactFailed = false;
  reactReady = false;

  constructor(
    private readonly portHost: NotebookRouteBoundaryPortHost,
    activatedRoute: ActivatedRoute,
    destroyRef: DestroyRef,
    cdr: ChangeDetectorRef
  ) {
    this.core = this.portHost.core;
    this.snapshot$ = this.portHost.snapshot$;
    this.reactModule =
      activatedRoute.snapshot.queryParamMap.get('simulateRemoteFailure') === 'true'
        ? './MissingNotebookRouteBoundaryProbe'
        : './NotebookRouteBoundaryProbe';
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
      },
      onReady: () => {
        this.reactReady = true;
        cdr.markForCheck();
      },
      onError: () => {
        this.reactFailed = true;
        cdr.markForCheck();
      }
    };

    window.__zeppelinNotebookRouteBoundaryProof = window.__zeppelinNotebookRouteBoundaryProof ?? {
      hostCore: this.core,
      proofs: [],
      receivedCores: []
    };

    activatedRoute.paramMap.pipe(takeUntilDestroyed(destroyRef)).subscribe(params => {
      this.portHost.enterRoute(params.get('noteId') ?? '', params.get('revisionId'));
    });
  }

  loadFixture(): void {
    const { noteId, revisionId } = this.core.getSnapshot();
    this.portHost.loadFixtureForRoute(noteId, revisionId);
  }

  loadStaleFixture(): void {
    this.portHost.loadFixtureForRoute('note-from-route', null);
  }

  applyMutation(): void {
    const index = this.core.getSnapshot().paragraphs.length;
    this.portHost.applyParagraphAdded(index);
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
