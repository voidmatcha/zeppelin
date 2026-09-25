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

import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import {
  AngularObjectRemove,
  AngularObjectUpdate,
  HeliumApplicationLoad,
  HeliumApplicationPackage,
  HeliumApplicationState,
  HeliumApplicationSuggestions,
  Note,
  OP,
  ParagraphItem
} from '@zeppelin/sdk';
import { Observable, Subject, Subscription } from 'rxjs';

import { BaseRest } from './base-rest';
import { BaseUrlService } from './base-url.service';
import { MessageService } from './message.service';

@Injectable({ providedIn: 'root' })
export class HeliumApplicationService extends BaseRest implements OnDestroy {
  readonly changes: Observable<void>;
  private noteId?: string;
  private readonly paragraphApps = new Map<string, HeliumApplicationState[]>();
  private readonly angularObjects = new Map<string, AngularObjectUpdate>();
  private readonly changed = new Subject<void>();
  private subscriptions?: Subscription;

  constructor(
    private http: HttpClient,
    private messageService: MessageService,
    baseUrlService: BaseUrlService
  ) {
    super(baseUrlService);
    this.changes = this.changed.asObservable();
    this.start();
  }

  start(): void {
    if (this.subscriptions) {
      return;
    }
    this.subscriptions = new Subscription();
    this.subscriptions.add(this.messageService.receive(OP.NOTE).subscribe(data => this.setNote(data)));
    this.subscriptions.add(
      this.messageService.receive(OP.PARAGRAPH).subscribe(({ paragraph }) => {
        if (this.noteId && this.paragraphApps.has(paragraph.id)) {
          this.setParagraph(paragraph);
          this.changed.next();
        }
      })
    );
    this.subscriptions.add(
      this.messageService.receive(OP.PARAGRAPH_ADDED).subscribe(({ paragraph }) => {
        if (this.noteId) {
          this.setParagraph(paragraph);
          this.changed.next();
        }
      })
    );
    this.subscriptions.add(
      this.messageService.receive(OP.PARAGRAPH_REMOVED).subscribe(({ id }) => {
        for (const app of this.paragraphApps.get(id) ?? []) {
          this.removeObject({ noteId: this.noteId!, paragraphId: app.id, name: '' }, true);
        }
        this.paragraphApps.delete(id);
        this.changed.next();
      })
    );
    this.subscriptions.add(this.messageService.receive(OP.APP_LOAD).subscribe(data => this.addApp(data)));
    this.subscriptions.add(
      this.messageService.receive(OP.APP_APPEND_OUTPUT).subscribe(data => {
        this.updateApp(data, app => ({ ...app, output: app.output + data.data }));
      })
    );
    this.subscriptions.add(
      this.messageService.receive(OP.APP_UPDATE_OUTPUT).subscribe(data => {
        this.updateApp(data, app => ({ ...app, output: data.data }));
      })
    );
    this.subscriptions.add(
      this.messageService.receive(OP.APP_STATUS_CHANGE).subscribe(data => {
        this.updateApp(data, app => ({ ...app, status: data.status }));
      })
    );
    this.subscriptions.add(
      this.messageService.receive(OP.ANGULAR_OBJECT_UPDATE).subscribe(data => {
        if (this.noteId && (!data.noteId || data.noteId === this.noteId)) {
          this.setObject(data);
          this.changed.next();
        }
      })
    );
    this.subscriptions.add(
      this.messageService.receive(OP.ANGULAR_OBJECT_REMOVE).subscribe(data => {
        if (this.noteId && (!data.noteId || data.noteId === this.noteId)) {
          this.removeObject(data);
          this.changed.next();
        }
      })
    );
  }

  stop(): void {
    this.subscriptions?.unsubscribe();
    this.subscriptions = undefined;
    this.noteId = undefined;
    this.paragraphApps.clear();
    this.angularObjects.clear();
    this.changed.next();
  }

  ngOnDestroy(): void {
    this.stop();
    this.changed.complete();
  }

  apps(noteId: string, paragraphId: string): HeliumApplicationState[] {
    return noteId === this.noteId ? [...(this.paragraphApps.get(paragraphId) ?? [])] : [];
  }

  objects(noteId: string, appId: string): AngularObjectUpdate[] {
    return noteId === this.noteId
      ? [...this.angularObjects.values()].filter(update => update.paragraphId === appId)
      : [];
  }

  suggest(noteId: string, paragraphId: string): Observable<HeliumApplicationSuggestions> {
    return this.http.get<HeliumApplicationSuggestions>(
      this.restUrl`/helium/suggest/${encodeURIComponent(noteId)}/${encodeURIComponent(paragraphId)}`
    );
  }

  load(noteId: string, paragraphId: string, pkg: HeliumApplicationPackage): Observable<string> {
    // AppHttpInterceptor unwraps JsonResponse.body (the application id).
    return this.http.post<string>(
      this.restUrl`/helium/load/${encodeURIComponent(noteId)}/${encodeURIComponent(paragraphId)}`,
      pkg
    );
  }

  private setNote({ note }: Note): void {
    this.noteId = note?.id;
    this.paragraphApps.clear();
    this.angularObjects.clear();
    if (note) {
      note.paragraphs.forEach(paragraph => this.setParagraph(paragraph));
      for (const [interpreterGroupId, objects] of Object.entries(note.angularObjects ?? {})) {
        for (const angularObject of objects as Array<AngularObjectUpdate['angularObject']>) {
          if (!angularObject.noteId || angularObject.noteId === note.id) {
            this.setObject({
              noteId: note.id,
              paragraphId: angularObject.paragraphId,
              interpreterGroupId,
              angularObject
            });
          }
        }
      }
    }
    this.changed.next();
  }

  private setParagraph(paragraph: ParagraphItem): void {
    const apps = (paragraph.apps ?? []) as HeliumApplicationState[];
    this.paragraphApps.set(
      paragraph.id,
      apps.map(app => ({ ...app, output: app.output ?? '' }))
    );
  }

  private addApp(data: HeliumApplicationLoad): void {
    if (data.noteId !== this.noteId || !this.paragraphApps.has(data.paragraphId)) {
      return;
    }
    const apps = this.paragraphApps.get(data.paragraphId)!;
    if (!apps.some(app => app.id === data.appId)) {
      this.paragraphApps.set(data.paragraphId, [
        ...apps,
        { id: data.appId, pkg: data.pkg, status: 'UNLOADED', output: '' }
      ]);
      this.changed.next();
    }
  }

  private updateApp(
    data: { noteId: string; paragraphId: string; appId: string },
    update: (app: HeliumApplicationState) => HeliumApplicationState
  ): void {
    if (data.noteId !== this.noteId) {
      return;
    }
    const apps = this.paragraphApps.get(data.paragraphId);
    if (apps?.some(app => app.id === data.appId)) {
      this.paragraphApps.set(
        data.paragraphId,
        apps.map(app => (app.id === data.appId ? update(app) : app))
      );
      this.changed.next();
    }
  }

  private setObject(update: AngularObjectUpdate): void {
    const key = JSON.stringify([update.interpreterGroupId, update.paragraphId, update.angularObject.name]);
    this.angularObjects.set(key, update);
  }

  private removeObject(data: AngularObjectRemove, allNames = false): void {
    for (const [key, update] of this.angularObjects) {
      if (update.paragraphId === data.paragraphId && (allNames || update.angularObject.name === data.name)) {
        this.angularObjects.delete(key);
      }
    }
  }
}
