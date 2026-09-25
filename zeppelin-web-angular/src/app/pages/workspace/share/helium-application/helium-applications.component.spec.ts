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
import { DatasetType, GraphConfig, HeliumApplicationPackage, ParagraphItem } from '@zeppelin/sdk';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HeliumApplicationService } from '../../../../services/helium-application.service';
import { HeliumApplicationsComponent } from './helium-applications.component';

const pkg: HeliumApplicationPackage = { name: 'clock', type: 'APPLICATION' };
const fixture = () => {
  const loaded = new Subject<string>();
  const service = {
    changes: new Subject<void>(),
    apps: vi.fn().mockReturnValue([{ id: 'app', pkg, status: 'LOADED', output: 'clock' }]),
    suggest: vi.fn().mockReturnValue(of({ available: [{ pkg }] })),
    load: vi.fn().mockReturnValue(loaded)
  };
  const component = new HeliumApplicationsComponent(
    service as unknown as HeliumApplicationService,
    { markForCheck: vi.fn() } as unknown as ChangeDetectorRef
  );
  component.noteId = 'note';
  component.paragraph = {
    id: 'paragraph',
    config: { results: { 0: { graph: new GraphConfig(), helium: { activeApp: 'app' } } } }
  } as ParagraphItem;
  component.status = 'FINISHED';
  return { component, service, loaded };
};

describe('Helium application selection', () => {
  it('accepts a configuration input replacement without replacing the paragraph', () => {
    const { component } = fixture();
    component.ngOnChanges();
    component.config = { results: { 0: { graph: new GraphConfig(), helium: { activeApp: 'remote-app' } } } };
    component.ngOnChanges();
    expect(component.activeAppId).toBe('remote-app');
    component.ngOnDestroy();
  });

  it('restores and saves Classic selection on the final result of a multi-output paragraph', () => {
    const { component } = fixture();
    const firstConfig = { graph: new GraphConfig() };
    const finalConfig = { graph: new GraphConfig(), helium: { activeApp: 'app' } };
    component.paragraph.results = {
      code: 'SUCCESS',
      msg: [
        { type: DatasetType.TEXT, data: 'before' },
        { type: DatasetType.TEXT, data: 'last' }
      ]
    } as ParagraphItem['results'];
    component.paragraph.config.results = { 0: firstConfig, 1: finalConfig };
    const changed = vi.fn();
    component.configChange.subscribe(changed);
    component.ngOnChanges();
    expect(component.resultIndex).toBe(1);
    expect(component.activeApp?.id).toBe('app');
    component.select(null);
    expect(changed).toHaveBeenCalledWith({ graph: finalConfig.graph, helium: { activeApp: undefined } });
    expect(component.paragraph.config.results[0]).toBe(firstConfig);
    component.ngOnDestroy();
  });

  it('applies changed saved selection without resetting a local selection on unrelated updates', () => {
    const { component } = fixture();
    component.ngOnChanges();
    component.select(null);
    component.ngOnChanges();
    expect(component.activeAppId).toBeNull();
    component.paragraph.config.results![0].helium!.activeApp = 'another-app';
    component.ngOnChanges();
    expect(component.activeAppId).toBe('another-app');
    component.ngOnDestroy();
  });

  it('restores a saved application and preserves graph settings when returning to output', () => {
    const { component } = fixture();
    const changed = vi.fn();
    component.configChange.subscribe(changed);
    component.ngOnChanges();
    expect(component.activeApp?.id).toBe('app');
    component.select(null);
    expect(component.activeApp).toBeUndefined();
    expect(changed).toHaveBeenCalledWith({
      graph: component.paragraph.config.results![0].graph,
      helium: { activeApp: undefined }
    });
    component.ngOnDestroy();
  });

  it('allows read-only viewers to select output without installing or saving settings', () => {
    const { component, service } = fixture();
    const changed = vi.fn();
    component.readOnly = true;
    component.configChange.subscribe(changed);
    component.ngOnChanges();
    component.load(pkg);
    component.select(null);
    expect(service.suggest).not.toHaveBeenCalled();
    expect(service.load).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('does not select a completed load after navigation to another paragraph', () => {
    const { component, loaded } = fixture();
    component.ngOnChanges();
    component.load(pkg);
    component.paragraph = { id: 'another', config: {} } as ParagraphItem;
    component.ngOnChanges();
    loaded.next('old-app');
    expect(component.activeAppId).toBeNull();
    expect(component.loading).toBe(false);
    component.ngOnDestroy();
  });

  it('keeps ordinary output visible when a saved application no longer exists', () => {
    const { component, service } = fixture();
    service.apps.mockReturnValue([]);
    component.ngOnChanges();
    expect(component.activeApp).toBeUndefined();
    component.ngOnDestroy();
  });
});
