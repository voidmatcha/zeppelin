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
import { HeliumService, MessageService } from '@zeppelin/services';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HeliumApplicationService } from '../../services/helium-application.service';
import { WorkspaceComponent } from './workspace.component';

vi.mock('@zeppelin/visualizations', () => ({ setTheme: vi.fn() }));

describe('workspace Helium lifecycle', () => {
  it('starts and stops Application subscriptions even if bundle initialization fails', async () => {
    const error = new Error('bundle service unavailable');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const applications = { start: vi.fn(), stop: vi.fn() };
    const component = new WorkspaceComponent(
      { connectedStatus$: of(true) } as unknown as MessageService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      {} as NzMessageService,
      { initPackages: () => Promise.reject(error) } as unknown as HeliumService,
      applications as unknown as HeliumApplicationService
    );
    try {
      component.ngOnInit();
      await Promise.resolve();
      expect(applications.start).toHaveBeenCalledOnce();
      expect(report).toHaveBeenCalledWith('Failed to initialize Helium packages', error);
      component.ngOnDestroy();
      expect(applications.stop).toHaveBeenCalledOnce();
    } finally {
      report.mockRestore();
    }
  });
});
