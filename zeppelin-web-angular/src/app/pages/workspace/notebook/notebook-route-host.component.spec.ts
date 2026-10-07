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
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MessageService, ReactFeatureService, SecurityService } from '@zeppelin/services';

vi.mock('./notebook.component', () => ({ NotebookComponent: class NotebookComponent {} }));
vi.mock('./notebook-core-read.component', () => ({ NotebookCoreReadComponent: class NotebookCoreReadComponent {} }));

import { NotebookComponent } from './notebook.component';
import { NotebookRouteHostComponent } from './notebook-route-host.component';

describe('NotebookRouteHostComponent', () => {
  it('keeps the editable route by default and destroys it before private Core view mounts', () => {
    const queryParamMap = new Subject<ParamMap>();
    const sequence: string[] = [];
    const host = new NotebookRouteHostComponent(
      { queryParamMap } as unknown as ActivatedRoute,
      new ReactFeatureService(),
      { received: () => new Subject() } as unknown as MessageService,
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
});
