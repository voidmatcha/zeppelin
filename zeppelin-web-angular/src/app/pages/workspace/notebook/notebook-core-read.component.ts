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

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { cloneDeep } from 'lodash';
import { Subscription } from 'rxjs';

import { NotebookCoreParagraphDraft, NotebookCoreReadSnapshot, NotebookCoreReadState } from '@zeppelin/notebook-core';
import { ParagraphConfigResult, ParagraphIResultsMsgItem } from '@zeppelin/sdk';
import { NotebookCoreReadHost } from './notebook-core-read-host';

@Component({
  selector: 'zeppelin-notebook-core-read',
  template: `
    <section
      class="notebook-core-read"
      [attr.aria-label]="canEdit ? 'Notebook editor preview' : 'Read-only notebook'"
      data-testid="notebook-core-read"
    >
      <p>{{ canEdit ? 'Private editor preview' : 'Read-only preview' }}</p>
      @switch (state.status) {
        @case ('initial') {
          <p role="status">Loading notebook…</p>
        }
        @case ('loading') {
          <p role="status">Loading notebook…</p>
        }
        @case ('notFound') {
          <p role="alert">Notebook not found.</p>
        }
        @case ('accessDenied') {
          <p role="alert">You do not have access to this notebook.</p>
        }
        @case ('failed') {
          <p role="alert">Could not load the notebook.</p>
        }
        @case ('ready') {
          <h1>{{ readData?.note?.name }}</h1>
          @if (state.acl.status === 'loading') {
            <p role="status">Loading permissions…</p>
          }
          @if (state.acl.status === 'accessDenied') {
            <p role="alert">Permissions are unavailable.</p>
          }
          @if (state.acl.status === 'failed') {
            <p role="alert">Could not load permissions.</p>
          }
          @if (state.acl.status === 'ready') {
            <section aria-label="Notebook permissions">
              <h2>Permissions</h2>
              <p>Owners: {{ state.acl.permissions.owners.join(', ') || 'None' }}</p>
              <p>Readers: {{ state.acl.permissions.readers.join(', ') || 'None' }}</p>
              <p>Writers: {{ state.acl.permissions.writers.join(', ') || 'None' }}</p>
              <p>Runners: {{ state.acl.permissions.runners.join(', ') || 'None' }}</p>
            </section>
          }
          @for (id of readData?.paragraphOrder; track id) {
            <article class="notebook-core-read-paragraph">
              <h2>{{ paragraph(id)?.title || 'Paragraph' }}</h2>
              @if (canEdit) {
                <label [attr.for]="'core-editor-' + id">Paragraph source</label>
                <textarea
                  [id]="'core-editor-' + id"
                  [value]="draftsById?.[id]?.text ?? paragraph(id)?.text"
                  (input)="editParagraph(id, $event)"
                ></textarea>
                <button type="button" (click)="saveParagraph(id)">Save paragraph</button>
                @if (paragraph(id)?.status === 'PENDING' || paragraph(id)?.status === 'RUNNING') {
                  <button type="button" (click)="cancelParagraph(id)">Cancel paragraph</button>
                } @else {
                  <button type="button" (click)="runParagraph(id)">Run paragraph</button>
                }
              } @else if (!isEditorHidden(id)) {
                <pre>{{ paragraph(id)?.text }}</pre>
              }
              <p>{{ paragraph(id)?.status }}</p>
              @if (!isResultHidden(id)) {
                @for (result of results(id); track $index) {
                  <div class="notebook-core-read-result" [attr.data-result-type]="result.type">
                    <zeppelin-notebook-paragraph-result
                      [result]="result"
                      [config]="resultConfig(id, $index)"
                      [id]="id + '_' + $index"
                      [published]="true"
                      [isPending]="false"
                    ></zeppelin-notebook-paragraph-result>
                  </div>
                }
              }
            </article>
          }
        }
      }
    </section>
  `,
  styles: [
    '.notebook-core-read { margin: 24px auto; max-width: 1100px; padding: 0 24px; }',
    '.notebook-core-read-paragraph { border: 1px solid #d9d9d9; margin: 16px 0; padding: 16px; }',
    '.notebook-core-read-paragraph textarea { display: block; min-height: 120px; width: 100%; }',
    '.notebook-core-read-paragraph pre { white-space: pre-wrap; overflow-wrap: anywhere; }'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookCoreReadComponent implements OnInit, OnDestroy {
  @Input({ required: true }) host!: NotebookCoreReadHost;
  @Input() editable = false;
  state: NotebookCoreReadState = { status: 'initial', acl: { status: 'loading' } };
  revisionId: string | null = null;
  draftsById?: Readonly<Record<string, NotebookCoreParagraphDraft>>;
  private readonly subscriptions = new Subscription();
  private readonly resultConfigs = new WeakMap<ParagraphConfigResult, ParagraphConfigResult>();

  constructor(private readonly cdr: ChangeDetectorRef) {}

  get readData(): NotebookCoreReadSnapshot | null {
    return this.state.status === 'ready' ? this.state.data : null;
  }

  get canEdit(): boolean {
    return this.editable && this.revisionId === null;
  }

  ngOnInit(): void {
    this.subscriptions.add(
      this.host.snapshot$.subscribe(snapshot => {
        this.state = snapshot.readState;
        this.revisionId = snapshot.revisionId;
        this.draftsById = snapshot.draftsById;
        this.cdr.markForCheck();
      })
    );
  }

  editParagraph(id: string, event: Event): void {
    if (this.canEdit && event.target instanceof HTMLTextAreaElement) {
      this.host.commandPort.dispatch({ type: 'editParagraph', paragraphId: id, text: event.target.value });
    }
  }

  saveParagraph(id: string): void {
    if (this.canEdit) {
      this.host.commandPort.dispatch({ type: 'saveParagraph', paragraphId: id });
    }
  }

  runParagraph(id: string): void {
    if (this.canEdit) {
      this.host.commandPort.dispatch({ type: 'runParagraph', paragraphId: id });
    }
  }

  cancelParagraph(id: string): void {
    if (this.canEdit) {
      this.host.commandPort.dispatch({ type: 'cancelParagraph', paragraphId: id });
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  paragraph(id: string): (NotebookCoreReadSnapshot['paragraphsById'][string] & { title?: string }) | undefined {
    return this.readData?.paragraphsById[id];
  }

  results(id: string): ParagraphIResultsMsgItem[] {
    const value = this.paragraph(id)?.results as { msg?: ParagraphIResultsMsgItem[] } | undefined;
    return value?.msg ?? [];
  }

  isEditorHidden(id: string): boolean {
    return (this.paragraph(id)?.config as { editorHide?: boolean } | undefined)?.editorHide === true;
  }

  isResultHidden(id: string): boolean {
    return (this.paragraph(id)?.config as { tableHide?: boolean } | undefined)?.tableHide === true;
  }

  resultConfig(id: string, index: number): ParagraphConfigResult | undefined {
    const config = this.paragraph(id)?.config as { results?: Record<string, ParagraphConfigResult> } | undefined;
    const saved = config?.results?.[index];
    if (!saved) return undefined;
    let mutable = this.resultConfigs.get(saved);
    if (!mutable) {
      mutable = cloneDeep(saved);
      this.resultConfigs.set(saved, mutable);
    }
    return mutable;
  }
}
