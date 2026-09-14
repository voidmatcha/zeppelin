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
import { Component, Injectable, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterModule, RouterStateSnapshot } from '@angular/router';
import type { IconDefinition } from '@ant-design/icons-angular';
import {
  ClockCircleOutline,
  CloseOutline,
  CopyOutline,
  DeleteOutline,
  DownOutline,
  DownloadOutline,
  EyeOutline,
  FireOutline,
  FolderOutline,
  FullscreenExitOutline,
  InfoCircleOutline,
  LeftOutline,
  LockFill,
  LockOutline,
  PauseCircleOutline,
  PlayCircleOutline,
  ReloadOutline,
  ReadOutline,
  RightOutline,
  RollbackOutline,
  SearchOutline,
  SettingFill,
  SettingOutline,
  SwapOutline,
  TeamOutline,
  ToTopOutline,
  UnorderedListOutline,
  UserOutline
} from '@ant-design/icons-angular/icons';
import { TRASH_FOLDER_ID_TOKEN } from '@zeppelin/interfaces';
import type { NotebookCorePort, NotebookCoreSnapshot } from '@zeppelin/notebook-core';
import { OP } from '@zeppelin/sdk';
import { NotebookComponent } from '@zeppelin/pages/workspace/notebook/notebook.component';
import {
  NOTEBOOK_CHILD_ROUTE_PATHS,
  NOTEBOOK_ROUTE_PATH
} from '@zeppelin/pages/workspace/notebook/notebook-route-boundary';
import { WorkspaceGuard } from '@zeppelin/pages/workspace/workspace.guard';
import { MessageService, ReactFeatureService, SecurityService } from '@zeppelin/services';
import { HeliumService } from '@zeppelin/services/helium.service';
import { ThemeService } from '@zeppelin/services/theme.service';
import { TicketService } from '@zeppelin/services/ticket.service';
import { ShareModule } from '@zeppelin/share';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_ICONS } from 'ng-zorro-antd/icon';
import { BehaviorSubject, NEVER, Subject, filter, of } from 'rxjs';

declare global {
  interface Window {
    __zeppelinNotebookCorePortProof?: {
      hostCore: NotebookCorePort;
      proofs: unknown[];
      receivedCore?: NotebookCorePort;
    };
    __zeppelinNotebookRouteBoundaryProof?: {
      activatedProductionNotebookComponents: boolean[];
      hostCore: NotebookCorePort;
      messageCalls: Array<{ method: string; noteId: string; revisionId?: string }>;
      proofs: unknown[];
      receivedCore?: NotebookCorePort;
      receivedCores: NotebookCorePort[];
      routePaths: string[];
      workspaceGuardCalls: string[];
    };
  }
}

const createSnapshot = (noteId: string, revisionId: string | null): NotebookCoreSnapshot => ({
  version: 0,
  noteId,
  revisionId,
  phase: 'idle',
  title: null,
  noteForms: {},
  noteParams: {},
  paragraphs: [],
  error: null
});

const proofIcons: IconDefinition[] = [
  ClockCircleOutline,
  CloseOutline,
  CopyOutline,
  DeleteOutline,
  DownOutline,
  DownloadOutline,
  EyeOutline,
  FireOutline,
  FolderOutline,
  FullscreenExitOutline,
  InfoCircleOutline,
  LeftOutline,
  LockFill,
  LockOutline,
  PauseCircleOutline,
  PlayCircleOutline,
  ReloadOutline,
  ReadOutline,
  RightOutline,
  RollbackOutline,
  SearchOutline,
  SettingFill,
  SettingOutline,
  SwapOutline,
  TeamOutline,
  ToTopOutline,
  UnorderedListOutline,
  UserOutline
];

@Component({
  selector: 'zeppelin-notebook-core-port-proof-app',
  standalone: false,
  template: `
    <router-outlet></router-outlet>
    @if (notebookRouteActive) {
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
      <div [zeppelin-react-mount]="'./NotebookRouteBoundaryProbe'" [reactProps]="routeReactProps"></div>
    }
  `
})
export class NotebookCorePortProofAppComponent {
  notebookRouteActive = false;
  readonly routeReactProps: Readonly<{
    core: NotebookCorePort;
    expectedCore: NotebookCorePort;
    onProof: (proof: unknown) => void;
    onReceivedCore: (receivedCore: NotebookCorePort) => void;
  }>;

  constructor(router: Router, portHost: NotebookRouteBoundaryPortHost) {
    this.routeReactProps = {
      core: portHost.core,
      expectedCore: portHost.core,
      onProof: proof => window.__zeppelinNotebookRouteBoundaryProof?.proofs.push(proof),
      onReceivedCore: receivedCore => {
        const state = window.__zeppelinNotebookRouteBoundaryProof;
        if (state) {
          state.receivedCore = receivedCore;
          state.receivedCores.push(receivedCore);
        }
      }
    };
    router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(() => {
      const notebookRoute = findActivatedNotebookRoute(router.routerState.snapshot.root);
      this.notebookRouteActive = notebookRoute !== undefined;
      if (notebookRoute) {
        window.__zeppelinNotebookRouteBoundaryProof?.activatedProductionNotebookComponents.push(
          notebookRoute.component === NotebookComponent
        );
        portHost.publish({
          noteId: notebookRoute.paramMap.get('noteId') ?? '',
          revisionId: notebookRoute.paramMap.get('revisionId')
        });
      }
    });
  }
}

const findActivatedNotebookRoute = (root: ActivatedRouteSnapshot): ActivatedRouteSnapshot | undefined => {
  let route: ActivatedRouteSnapshot | null = root;
  while (route) {
    if (route.component === NotebookComponent) {
      return route;
    }
    route = route.firstChild;
  }
  return undefined;
};

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
    },
    dispatch: () => false
  });
  readonly reactProps = {
    core: this.core,
    expectedCore: this.core,
    onProof: (proof: unknown) => window.__zeppelinNotebookCorePortProof?.proofs.push(proof),
    onReceivedCore: (receivedCore: NotebookCorePort) => {
      window.__zeppelinNotebookCorePortProof = window.__zeppelinNotebookCorePortProof ?? {
        hostCore: this.core,
        proofs: []
      };
      window.__zeppelinNotebookCorePortProof.receivedCore = receivedCore;
    }
  };
  private snapshot = createSnapshot('note-host-owned', null);
  private readonly listeners = new Set<() => void>();

  constructor() {
    window.__zeppelinNotebookCorePortProof = { hostCore: this.core, proofs: [] };
  }

  publishRevision(): void {
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, revisionId: 'revision-from-angular-host' };
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
    },
    dispatch: () => false
  });
  private snapshot = createSnapshot('', null);
  private readonly listeners = new Set<() => void>();

  constructor() {
    window.__zeppelinNotebookRouteBoundaryProof = {
      activatedProductionNotebookComponents: [],
      hostCore: this.core,
      messageCalls: [],
      proofs: [],
      receivedCores: [],
      routePaths: NOTEBOOK_CHILD_ROUTE_PATHS.map(path => `${NOTEBOOK_ROUTE_PATH}/${path}`),
      workspaceGuardCalls: []
    };
  }

  publish(route: Pick<NotebookCoreSnapshot, 'noteId' | 'revisionId'>): void {
    this.snapshot = {
      ...this.snapshot,
      version: this.snapshot.version + 1,
      noteId: route.noteId,
      revisionId: route.revisionId
    };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

class ProofMessageService {
  readonly connectedStatus = true;
  readonly connectedStatus$ = new BehaviorSubject(true);
  private readonly received = new Map<OP, Subject<unknown>>();
  private readonly receivedEnvelopes = new Map<OP, Subject<unknown>>();
  private activeNoteId?: string;
  private activeRevisionId?: string;
  private nextMsgId = 0;

  receive(op: OP) {
    let subject = this.received.get(op);
    if (!subject) {
      subject = new Subject();
      this.received.set(op, subject);
    }
    return subject;
  }
  receiveMessage() {
    return NEVER;
  }
  receiveEnvelope(op: OP) {
    let subject = this.receivedEnvelopes.get(op);
    if (!subject) {
      subject = new Subject();
      this.receivedEnvelopes.set(op, subject);
    }
    return subject;
  }
  sent() {
    return NEVER;
  }
  bootstrap() {}
  close() {}
  connect() {}
  getNote(noteId: string) {
    window.__zeppelinNotebookRouteBoundaryProof?.messageCalls.push({ method: 'getNote', noteId });
    queueMicrotask(() => this.publishNote(OP.NOTE, noteId, null));
  }
  noteRevision(noteId: string, revisionId: string) {
    const receipt = this.createReceipt(OP.NOTE_REVISION);
    window.__zeppelinNotebookRouteBoundaryProof?.messageCalls.push({ method: 'noteRevision', noteId, revisionId });
    queueMicrotask(() => this.publishNote(OP.NOTE_REVISION, noteId, revisionId, receipt.msgId));
    return receipt;
  }
  listRevisionHistory(noteId: string) {
    window.__zeppelinNotebookRouteBoundaryProof?.messageCalls.push({ method: 'listRevisionHistory', noteId });
    return this.createReceipt(OP.LIST_REVISION_HISTORY);
  }
  getInterpreterBindings() {
    return this.createReceipt(OP.GET_INTERPRETER_BINDINGS);
  }
  activateNotebookRoute(noteId: string, revisionId?: string) {
    this.activeNoteId = noteId;
    this.activeRevisionId = revisionId;
  }
  deactivateNotebookRoute() {
    this.activeNoteId = undefined;
    this.activeRevisionId = undefined;
  }
  isCurrentNotebookReply(message: { msgId?: string }, _op: OP, noteId?: string, revisionId?: string) {
    return Boolean(
      message.msgId &&
      noteId === this.activeNoteId &&
      (this.activeRevisionId === undefined || revisionId === this.activeRevisionId)
    );
  }
  settleNotebookScopedFailure() {
    return false;
  }

  private createReceipt(op: OP) {
    return { op, msgId: `proof-${++this.nextMsgId}` };
  }

  private publishNote(op: OP.NOTE | OP.NOTE_REVISION, noteId: string, revisionId: string | null, msgId?: string): void {
    const data = {
      note: {
        paragraphs: [],
        name: `Proof ${noteId}`,
        id: noteId,
        path: `/${noteId}`,
        defaultInterpreterGroup: '',
        noteParams: {},
        noteForms: {},
        angularObjects: {},
        config: {
          releaseresource: false,
          isZeppelinNotebookCronEnable: false,
          looknfeel: 'default',
          personalizedMode: 'false'
        },
        info: {}
      },
      ...(revisionId === null ? {} : { revisionId })
    };
    if (op === OP.NOTE_REVISION) {
      this.receivedEnvelopes.get(op)?.next({ op, data, msgId });
    } else {
      this.received.get(op)?.next(data);
    }
  }
}

@Injectable()
class ProofWorkspaceGuard {
  canActivate(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    window.__zeppelinNotebookRouteBoundaryProof?.workspaceGuardCalls.push(state.url);
    return true;
  }
}

@NgModule({
  bootstrap: [NotebookCorePortProofAppComponent],
  declarations: [NotebookCorePortProofAppComponent, NotebookCorePortProofComponent],
  imports: [
    BrowserModule,
    CommonModule,
    ShareModule,
    RouterModule.forRoot(
      [
        { path: 'port-identity', component: NotebookCorePortProofComponent },
        {
          path: '',
          loadChildren: () =>
            import('@zeppelin/pages/workspace/workspace.module').then(module => module.WorkspaceModule)
        }
      ],
      { useHash: true }
    )
  ],
  providers: [
    { provide: WorkspaceGuard, useClass: ProofWorkspaceGuard },
    { provide: MessageService, useClass: ProofMessageService },
    {
      provide: SecurityService,
      useValue: {
        getPermissions: () => of({ owners: [], readers: [], runners: [], writers: [] })
      }
    },
    { provide: HeliumService, useValue: { initPackages: () => undefined } },
    { provide: NZ_ICONS, useValue: proofIcons },
    { provide: NzMessageService, useValue: { loading: () => ({ messageId: 'proof' }), remove: () => undefined } },
    ReactFeatureService,
    {
      provide: ThemeService,
      useValue: {
        effectiveTheme$: of('light'),
        getCurrentTheme: () => 'light',
        theme$: of('light'),
        toggleTheme: () => undefined,
        updateMonacoTheme: () => undefined
      }
    },
    {
      provide: TicketService,
      useValue: {
        getTicket: () => NEVER,
        ticket: { init: true, principal: 'anonymous', screenUsername: 'anonymous' }
      }
    },
    { provide: TRASH_FOLDER_ID_TOKEN, useValue: '~Trash' }
  ]
})
export class NotebookCorePortProofModule {}

void platformBrowserDynamic().bootstrapModule(NotebookCorePortProofModule);
