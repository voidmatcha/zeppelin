/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { HttpClient } from '@angular/common/http';
import { DatasetType } from '@zeppelin/sdk';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BaseUrlService } from './base-url.service';
import { HeliumService } from './helium.service';

const baseUrl = { getRestApiBase: () => '/api' } as BaseUrlService;

describe('HeliumService Spell bundles', () => {
  it('registers an enabled Spell bundle and executes it with server configuration', async () => {
    const get = vi.fn((url: string) => {
      if (url === '/api/helium/enabledPackage') {
        return of([{ pkg: { name: 'demo-spell' } }]);
      }
      if (url === '/api/helium/bundle/load/demo-spell') {
        return of(`window._heliumBundles.push({
          id: 'demo-spell',
          name: 'Demo',
          icon: '',
          type: 'SPELL',
          class: class {
            getMagic() { return '%demo'; }
            interpret(text, config) {
              return {
                getAllParsedDataWithTypes(displays, magic, originalText) {
                  if (displays[magic].getMagic() !== '%demo' || originalText !== text) {
                    return Promise.reject(new Error('parser context was not forwarded'));
                  }
                  return Promise.resolve([
                    { type: 'TEXT', data: text + ':' + config.count },
                    { type: 'HTML', data: '<strong>async display</strong>' }
                  ]);
                }
              };
            }
          }
        })`);
      }
      if (url === '/api/helium/spell/config/demo-spell') {
        return of({ confSpec: { count: { type: 'number', defaultValue: 1 } }, confPersisted: { count: '2' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const service = new HeliumService({ get } as unknown as HttpClient, baseUrl);

    service.initPackages();
    const results = await service.executeSpell('%demo', 'input');

    expect(service.getSpellByMagic('%demo')).not.toBeNull();
    expect(results).toEqual([
      { type: DatasetType.TEXT, data: 'input:2' },
      { type: DatasetType.HTML, data: '<strong>async display</strong>' }
    ]);
    expect(get).toHaveBeenCalledWith('/api/helium/spell/config/demo-spell');
  });

  it('rejects execution when no enabled bundle registered the requested magic', async () => {
    const service = new HeliumService({ get: vi.fn(() => of([])) } as unknown as HttpClient, baseUrl);

    await expect(service.executeSpell('%missing', 'input')).rejects.toThrow('%missing');
  });

  it('waits for the single in-flight bundle initialization before resolving a Spell', async () => {
    const enabledPackages = new Subject<Array<{ pkg: { name: string } }>>();
    const get = vi.fn((url: string) => {
      if (url === '/api/helium/enabledPackage') {
        return enabledPackages;
      }
      if (url === '/api/helium/bundle/load/delayed-spell') {
        return of(`window._heliumBundles.push({
          id: 'delayed-spell', type: 'SPELL', class: class {
            getMagic() { return '%delayed'; }
            interpret(text) {
              return { getAllParsedDataWithTypes() { return Promise.resolve([{ type: 'TEXT', data: text }]); } };
            }
          }
        })`);
      }
      return of({ confSpec: {}, confPersisted: {} });
    });
    const service = new HeliumService({ get } as unknown as HttpClient, baseUrl);

    const initialized = service.initPackages();
    const available = service.hasSpell('%delayed');
    expect(get.mock.calls.filter(([url]) => url === '/api/helium/enabledPackage')).toHaveLength(1);

    enabledPackages.next([{ pkg: { name: 'delayed-spell' } }]);
    enabledPackages.complete();

    await expect(initialized).resolves.toBeUndefined();
    await expect(available).resolves.toBe(true);
  });

  it('executes a nested custom display without forwarding source context', async () => {
    const get = vi.fn((url: string) => {
      if (url === '/api/helium/enabledPackage') {
        return of([{ pkg: { name: 'custom-spell' } }]);
      }
      if (url === '/api/helium/bundle/load/custom-spell') {
        return of(`window._heliumBundles.push({
          id: 'custom-spell', type: 'SPELL', class: class {
            getMagic() { return '%custom'; }
            interpret(text) {
              return {
                getAllParsedDataWithTypes(displays, magic, originalText) {
                  if (magic !== undefined || originalText !== undefined) {
                    return Promise.reject(new Error('unexpected source context'));
                  }
                  return Promise.resolve([{ type: 'HTML', data: '<b>' + text + '</b>' }]);
                }
              };
            }
          }
        })`);
      }
      return of({ confSpec: {}, confPersisted: {} });
    });
    const service = new HeliumService({ get } as unknown as HttpClient, baseUrl);

    await expect(service.executeSpellAsDisplaySystem('%custom', '  nested  ')).resolves.toEqual([
      { type: DatasetType.HTML, data: '<b>nested</b>', magic: undefined, text: undefined }
    ]);
  });

  it('rejects a package that does not return the legacy SpellResult parser contract', async () => {
    const get = vi.fn((url: string) => {
      if (url === '/api/helium/enabledPackage') {
        return of([{ pkg: { name: 'broken-spell' } }]);
      }
      if (url === '/api/helium/bundle/load/broken-spell') {
        return of(`window._heliumBundles.push({
          id: 'broken-spell', type: 'SPELL', class: class {
            getMagic() { return '%broken'; }
            interpret() { return { data: 'not-a-SpellResult' }; }
          }
        })`);
      }
      return of({ confSpec: {}, confPersisted: {} });
    });
    const service = new HeliumService({ get } as unknown as HttpClient, baseUrl);
    service.initPackages();

    await expect(service.executeSpell('%broken', 'input')).rejects.toThrow('incompatible result');
  });
});
