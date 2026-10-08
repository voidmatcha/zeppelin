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

import type { ActivatedRoute, ParamMap } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MessageService, ReactFeatureService, SecurityService } from '@zeppelin/services';

vi.mock('./notebook.component', () => ({ NotebookComponent: class NotebookComponent {} }));
vi.mock('./notebook-core-read.component', () => ({ NotebookCoreReadComponent: class NotebookCoreReadComponent {} }));
vi.mock('./notebook-react-entry.component', () => ({
  NotebookReactEntryComponent: class NotebookReactEntryComponent {}
}));

import { NotebookComponent } from './notebook.component';
import { NotebookCoreReadComponent } from './notebook-core-read.component';
import { NotebookReactEntryComponent } from './notebook-react-entry.component';
import { NotebookRouteHostComponent } from './notebook-route-host.component';

describe('NotebookRouteHostComponent', () => {
  it('keeps the editable route by default and destroys it before private Core view mounts', () => {
    const queryParamMap = new Subject<ParamMap>();
    const paramMap = new BehaviorSubject({ get: () => 'note-1' } as unknown as ParamMap);
    const sequence: string[] = [];
    const host = new NotebookRouteHostComponent(
      { queryParamMap, paramMap } as unknown as ActivatedRoute,
      new ReactFeatureService(),
      {
        received: () => new Subject(),
        connectedStatus$: new BehaviorSubject(false),
        connectedStatus: false
      } as unknown as MessageService,
      {} as SecurityService
    );
    (host as unknown as { outlet: unknown }).outlet = {
      clear: vi.fn(() => sequence.push('destroy')),
      createComponent: vi.fn(component => {
        sequence.push(component === NotebookComponent ? 'editable' : 'core');
        return { setInput: vi.fn() };
      })
    };

    host.ngOnInit();
    queryParamMap.next({ get: () => null } as unknown as ParamMap);
    queryParamMap.next({ get: () => 'true' } as unknown as ParamMap);
    queryParamMap.next({ get: () => 'true' } as unknown as ParamMap);
    expect(sequence).toEqual(['destroy', 'editable', 'destroy', 'core']);
    host.ngOnDestroy();
    expect(sequence.at(-1)).toBe('destroy');
  });

  it('falls back to Angular with the same Core port when private React entry fails', () => {
    const queryParamMap = new Subject<ParamMap>();
    const paramMap = new BehaviorSubject({ get: () => 'note-1' } as unknown as ParamMap);
    const mounted: Array<{ component: unknown; inputs: Record<string, unknown> }> = [];
    const host = new NotebookRouteHostComponent(
      { queryParamMap, paramMap } as unknown as ActivatedRoute,
      new ReactFeatureService(),
      {
        received: () => new Subject(),
        connectedStatus$: new BehaviorSubject(false),
        connectedStatus: false
      } as unknown as MessageService,
      {} as SecurityService
    );
    (host as unknown as { outlet: unknown }).outlet = {
      clear: vi.fn(),
      createComponent: vi.fn(component => {
        const entry = { component, inputs: {} as Record<string, unknown> };
        mounted.push(entry);
        return { setInput: vi.fn((key: string, value: unknown) => (entry.inputs[key] = value)) };
      })
    };

    host.ngOnInit();
    queryParamMap.next({ get: (name: string) => (name === 'notebookReactPrivate' ? 'true' : null) } as ParamMap);
    expect(mounted[0].component).toBe(NotebookReactEntryComponent);
    const core = mounted[0].inputs.host;
    (mounted[0].inputs.onEntryFailure as () => void)();
    expect(mounted[1].component).toBe(NotebookCoreReadComponent);
    expect(mounted[1].inputs.host).toBe(core);

    queryParamMap.next({ get: () => null } as unknown as ParamMap);
    expect(mounted[2].component).toBe(NotebookComponent);
    host.ngOnDestroy();
  });

  it('keeps the private editor enabled when the React editor falls back to Angular', () => {
    const queryParamMap = new Subject<ParamMap>();
    const paramMap = new BehaviorSubject({ get: () => 'note-1' } as unknown as ParamMap);
    const mounted: Array<{ component: unknown; inputs: Record<string, unknown> }> = [];
    const host = new NotebookRouteHostComponent(
      { queryParamMap, paramMap } as unknown as ActivatedRoute,
      new ReactFeatureService(),
      {
        received: () => new Subject(),
        connectedStatus$: new BehaviorSubject(false),
        connectedStatus: false
      } as unknown as MessageService,
      {} as SecurityService
    );
    (host as unknown as { outlet: unknown }).outlet = {
      clear: vi.fn(),
      createComponent: vi.fn(component => {
        const entry = { component, inputs: {} as Record<string, unknown> };
        mounted.push(entry);
        return { setInput: vi.fn((key: string, value: unknown) => (entry.inputs[key] = value)) };
      })
    };

    host.ngOnInit();
    queryParamMap.next({ get: (name: string) => (name === 'notebookReactEditPrivate' ? 'true' : null) } as ParamMap);
    expect(mounted[0].component).toBe(NotebookReactEntryComponent);
    expect(mounted[0].inputs.editable).toBe(true);
    const core = mounted[0].inputs.host;
    (mounted[0].inputs.onEntryFailure as () => void)();
    expect(mounted[1].component).toBe(NotebookCoreReadComponent);
    expect(mounted[1].inputs.host).toBe(core);
    expect(mounted[1].inputs.editable).toBe(true);
    host.ngOnDestroy();
  });
});
