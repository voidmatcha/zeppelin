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

import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NotebookCoreReadStore, NotebookCoreWireNote } from '@zeppelin/notebook-core';
import { ParagraphConfigResult } from '@zeppelin/sdk';
import { MessageService } from '@zeppelin/services';
import { NotebookCoreReadComponent } from './notebook-core-read.component';
import { NotebookCoreReadHost } from './notebook-core-read-host';

describe('NotebookCoreReadComponent', () => {
  it('passes a mutable copy of saved chart config to the Angular renderer', () => {
    const store = new NotebookCoreReadStore('');
    const request = store.beginRoute('note-1', null);
    store.acceptNote(request, {
      id: 'note-1',
      name: 'Saved note',
      path: '/Saved note',
      paragraphs: [
        {
          id: 'paragraph-1',
          text: '%sh saved',
          status: 'FINISHED',
          config: { results: { 0: { graph: { mode: 'multiBarChart', keys: [], groups: [], values: [] } } } },
          results: { msg: [{ type: 'TABLE', data: 'city\tvalue\nSeoul\t2' }] }
        }
      ]
    } as unknown as NotebookCoreWireNote);
    store.acceptPermissions(request, { owners: ['owner'], readers: [], writers: [], runners: [] });
    const component = new NotebookCoreReadComponent(
      { paramMap: NEVER } as unknown as ActivatedRoute,
      { connectedStatus$: NEVER, connectedStatus: true } as unknown as MessageService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef
    );
    component.host = { snapshot$: of(store.getSnapshot()) } as NotebookCoreReadHost;
    component.ngOnInit();

    const saved = (component.paragraph('paragraph-1')?.config as { results: Record<string, ParagraphConfigResult> })
      .results[0];
    const rendered = component.resultConfig('paragraph-1', 0);
    expect(component.state.acl).toMatchObject({ status: 'ready', permissions: { owners: ['owner'] } });
    expect(rendered?.graph.mode).toBe('multiBarChart');
    expect(rendered).not.toBe(saved);
    expect(component.resultConfig('paragraph-1', 0)).toBe(rendered);
    rendered!.graph.mode = 'table';
    expect(saved?.graph.mode).toBe('multiBarChart');

    component.ngOnDestroy();
    store.dispose();
  });
});
