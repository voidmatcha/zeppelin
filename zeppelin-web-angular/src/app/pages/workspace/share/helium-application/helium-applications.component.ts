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

import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output } from '@angular/core';
import {
  GraphConfig,
  HeliumApplicationPackage,
  HeliumApplicationState,
  ParagraphConfigResult,
  ParagraphItem
} from '@zeppelin/sdk';
import { Subject, Subscription, takeUntil } from 'rxjs';

import { HeliumApplicationService } from '../../../../services/helium-application.service';

@Component({
  selector: 'zeppelin-helium-applications',
  standalone: false,
  template: `
    @if (apps.length || suggestions.length) {
      <div class="application-controls" aria-label="Paragraph applications">
        <button type="button" (click)="select(null)" [attr.aria-pressed]="!activeAppId">Output</button>
        @for (app of apps; track app.id) {
          <button type="button" (click)="select(app.id)" [attr.aria-pressed]="activeAppId === app.id">
            {{ app.pkg.name }} ({{ app.status }})
          </button>
        }
        @if (!readOnly) {
          @for (pkg of suggestions; track pkg.name) {
            <button type="button" (click)="load(pkg)" [disabled]="loading">Load {{ pkg.name }}</button>
          }
        }
      </div>
    }
    @if (error) {
      <p role="alert">{{ error }}</p>
    }
    @for (app of apps; track app.id) {
      @if (app.id === activeAppId) {
        <zeppelin-helium-application-output [noteId]="noteId" [paragraph]="paragraph" [app]="app" />
      }
    }
  `,
  styles: [
    '.application-controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; } button[aria-pressed="true"] { font-weight: bold; }'
  ]
})
export class HeliumApplicationsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() noteId = '';
  @Input() paragraph!: ParagraphItem;
  @Input() config?: ParagraphItem['config'];
  @Input() status = '';
  @Input() readOnly = false;
  @Output() readonly configChange = new EventEmitter<ParagraphConfigResult>();
  apps: HeliumApplicationState[] = [];
  suggestions: HeliumApplicationPackage[] = [];
  activeAppId: string | null = null;
  loading = false;
  error = '';
  private readonly destroyed = new Subject<void>();
  private suggestionRequest?: Subscription;
  private context = '';
  private savedAppId: string | null = null;

  get activeApp(): HeliumApplicationState | undefined {
    return this.apps.find(app => app.id === this.activeAppId);
  }

  get resultIndex(): number {
    // Classic attaches Application selection to the final output, not the first one.
    return Math.max(0, (this.paragraph?.results?.msg?.length || 0) - 1);
  }

  constructor(
    private service: HeliumApplicationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.service.changes.pipe(takeUntil(this.destroyed)).subscribe(() => this.refresh());
    this.refresh();
  }

  ngOnChanges(): void {
    if (!this.paragraph || !this.noteId) {
      return;
    }
    const context = `${this.noteId}/${this.paragraph.id}`;
    const savedAppId = (this.config ?? this.paragraph.config).results?.[this.resultIndex]?.helium?.activeApp || null;
    if (context !== this.context) {
      this.context = context;
      this.activeAppId = savedAppId;
      this.suggestions = [];
      this.error = '';
      this.loading = false;
    } else if (savedAppId !== this.savedAppId) {
      this.activeAppId = savedAppId;
    }
    this.savedAppId = savedAppId;
    this.refresh();
    this.suggestionRequest?.unsubscribe();
    if (!this.readOnly && this.status !== 'RUNNING' && this.status !== 'PENDING') {
      this.suggestionRequest = this.service.suggest(this.noteId, this.paragraph.id).subscribe({
        next: response => {
          this.suggestions = response.available.map(item => item.pkg);
          this.cdr.markForCheck();
        },
        error: () => {
          this.suggestions = [];
          this.cdr.markForCheck();
        }
      });
    }
  }

  select(id: string | null): void {
    this.activeAppId = id;
    if (!this.readOnly) {
      const config = (this.config ?? this.paragraph.config).results?.[this.resultIndex] || { graph: new GraphConfig() };
      this.configChange.emit({ ...config, helium: { ...config.helium, activeApp: id || undefined } });
    }
    this.cdr.markForCheck();
  }

  load(pkg: HeliumApplicationPackage): void {
    if (this.readOnly || this.loading) {
      return;
    }
    const context = this.context;
    this.loading = true;
    this.error = '';
    this.service
      .load(this.noteId, this.paragraph.id, pkg)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: id => {
          if (context === this.context) {
            this.loading = false;
            this.refresh();
            this.select(id);
          }
        },
        error: error => {
          if (context === this.context) {
            this.loading = false;
            this.error = error?.error?.message || error?.message || 'Could not load this application.';
            this.cdr.markForCheck();
          }
        }
      });
  }

  private refresh(): void {
    if (this.paragraph) {
      this.apps = this.service.apps(this.noteId, this.paragraph.id);
    }
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.suggestionRequest?.unsubscribe();
    this.destroyed.next();
    this.destroyed.complete();
  }
}
