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

import { ChangeDetectorRef, ElementRef } from '@angular/core';
import { ParagraphItem } from '@zeppelin/sdk';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HeliumApplicationRuntimeService } from '../../../../services/helium-application-runtime.service';
import { HeliumApplicationService } from '../../../../services/helium-application.service';
import { MessageService } from '../../../../services/message.service';
import { HeliumApplicationOutputComponent } from './helium-application-output.component';

describe('Helium application output host', () => {
  it('isolates a failing application and recovers on new output without repeatedly executing the failed script', () => {
    const changes = new Subject<void>();
    const handle = {
      render: vi.fn().mockImplementationOnce(() => {
        throw new Error('broken application');
      }),
      updateObject: vi.fn(),
      removeObject: vi.fn(),
      destroy: vi.fn()
    };
    const component = new HeliumApplicationOutputComponent(
      { mount: vi.fn().mockReturnValue(handle) } as unknown as HeliumApplicationRuntimeService,
      { changes, objects: vi.fn().mockReturnValue([]) } as unknown as HeliumApplicationService,
      { receive: vi.fn().mockReturnValue(new Subject()), send: vi.fn() } as unknown as MessageService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef
    );
    component.output = new ElementRef(document.createElement('div'));
    component.noteId = 'note';
    component.paragraph = { id: 'paragraph' } as ParagraphItem;
    component.app = { id: 'app', pkg: { name: 'clock', type: 'APPLICATION' }, status: 'LOADED', output: 'broken' };
    component.ngAfterViewInit();
    expect(component.error).toContain('broken application');
    changes.next();
    expect(handle.render).toHaveBeenCalledTimes(1);
    component.app = { ...component.app, output: 'recovered' };
    component.ngOnChanges();
    expect(component.error).toBe('');
    expect(handle.render).toHaveBeenLastCalledWith('recovered');
    component.ngOnDestroy();
    changes.next();
    expect(handle.render).toHaveBeenCalledTimes(2);
    expect(handle.destroy).toHaveBeenCalledOnce();
  });
});
