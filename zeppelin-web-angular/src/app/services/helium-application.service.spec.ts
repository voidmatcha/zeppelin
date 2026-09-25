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
import {
  AngularObjectUpdate,
  HeliumApplicationPackage,
  Message,
  MessageReceiveDataTypeMap,
  OP,
  WebSocketMessage
} from '@zeppelin/sdk';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseUrlService } from './base-url.service';
import { HeliumApplicationService } from './helium-application.service';
import { MessageService } from './message.service';

const pkg: HeliumApplicationPackage = { type: 'APPLICATION', name: 'demo', artifact: 'demo:1' };
const state = (output = 'saved') => ({ id: 'app', pkg, output, status: 'LOADED' });
const services: HeliumApplicationService[] = [];

const setup = (message = new Message()) => {
  const get = vi.fn().mockReturnValue(of({ available: [{ pkg }] }));
  const post = vi.fn().mockReturnValue(of('app'));
  const service = new HeliumApplicationService(
    { get, post } as unknown as HttpClient,
    message as MessageService,
    { getRestApiBase: () => '/zeppelin/api' } as BaseUrlService
  );
  services.push(service);
  const send = (op: keyof MessageReceiveDataTypeMap, data: unknown) => {
    message.shortCircuit({ op, data } as WebSocketMessage<MessageReceiveDataTypeMap>);
  };
  const note = (id = 'note', apps = [state()], angularObjects = {}) => {
    send(OP.NOTE, {
      note: {
        id,
        paragraphs: [
          { id: 'p', apps },
          { id: 'other', apps: [] }
        ],
        angularObjects
      }
    });
  };
  return { service, send, note, get, post };
};

afterEach(() => {
  services.splice(0).forEach(service => service.ngOnDestroy());
});

describe('HeliumApplicationService', () => {
  it('keeps two clients in sync and restores a late client from a note snapshot', () => {
    const message = new Message();
    const first = setup(message);
    const second = setup(message);
    first.note('note', [state('initial')]);
    first.send(OP.APP_UPDATE_OUTPUT, {
      noteId: 'note',
      paragraphId: 'p',
      appId: 'app',
      index: 0,
      type: 'ANGULAR',
      data: 'live'
    });
    expect(first.service.apps('note', 'p')[0].output).toBe('live');
    expect(second.service.apps('note', 'p')[0].output).toBe('live');

    const late = setup(message);
    first.note('note', [state('live')]);
    expect(late.service.apps('note', 'p')[0].output).toBe('live');
    first.send(OP.APP_APPEND_OUTPUT, {
      noteId: 'note',
      paragraphId: 'p',
      appId: 'app',
      index: 0,
      data: ' update'
    });
    expect([first, second, late].map(client => client.service.apps('note', 'p')[0].output)).toEqual([
      'live update',
      'live update',
      'live update'
    ]);
  });

  it('restores snapshots and applies append, replace and status only to the addressed app', () => {
    const { service, send, note } = setup();
    const changed = vi.fn();
    service.changes.subscribe(changed);
    note();
    send(OP.APP_APPEND_OUTPUT, { noteId: 'note', paragraphId: 'p', appId: 'app', index: 0, data: ' + live' });
    expect(service.apps('note', 'p')[0].output).toBe('saved + live');
    send(OP.APP_UPDATE_OUTPUT, {
      noteId: 'note',
      paragraphId: 'p',
      appId: 'app',
      index: 0,
      type: 'ANGULAR',
      data: '<b>new</b>'
    });
    send(OP.APP_STATUS_CHANGE, { noteId: 'note', paragraphId: 'p', appId: 'app', status: 'ERROR' });
    expect(service.apps('note', 'p')).toEqual([{ ...state('<b>new</b>'), status: 'ERROR' }]);
    expect(service.apps('note', 'other')).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('ignores other notes, other paragraphs and unknown apps', () => {
    const { service, send, note } = setup();
    note();
    for (const address of [
      { noteId: 'other-note', paragraphId: 'p', appId: 'app' },
      { noteId: 'note', paragraphId: 'other', appId: 'app' },
      { noteId: 'note', paragraphId: 'p', appId: 'missing' }
    ]) {
      send(OP.APP_APPEND_OUTPUT, { ...address, index: 0, data: 'wrong' });
      send(OP.APP_STATUS_CHANGE, { ...address, status: 'ERROR' });
    }
    send(OP.APP_LOAD, { noteId: 'other-note', paragraphId: 'p', appId: 'wrong', pkg });
    send(OP.APP_LOAD, { noteId: 'note', paragraphId: 'missing', appId: 'wrong', pkg });
    expect(service.apps('note', 'p')).toEqual([state()]);
    expect(service.apps('other-note', 'p')).toEqual([]);
    expect(service.apps('note', 'missing')).toEqual([]);
  });

  it('adds a loaded application once without resetting output on duplicate APP_LOAD', () => {
    const { service, send, note } = setup();
    note('note', []);
    const load = { noteId: 'note', paragraphId: 'p', appId: 'app', pkg };
    send(OP.APP_LOAD, load);
    expect(service.apps('note', 'p')).toEqual([{ ...state(''), status: 'UNLOADED' }]);
    send(OP.APP_APPEND_OUTPUT, { ...load, index: 0, data: 'first' });
    send(OP.APP_LOAD, load);
    expect(service.apps('note', 'p')).toEqual([{ ...state('first'), status: 'UNLOADED' }]);
  });

  it('reconciles paragraph snapshots and clears apps from the previous note', () => {
    const { service, send, note } = setup();
    note();
    send(OP.PARAGRAPH, { paragraph: { id: 'p', apps: [state('snapshot')] } });
    expect(service.apps('note', 'p')[0].output).toBe('snapshot');
    send(OP.PARAGRAPH, { paragraph: { id: 'unknown', apps: [state()] } });
    expect(service.apps('note', 'unknown')).toEqual([]);
    note('next', []);
    send(OP.APP_APPEND_OUTPUT, { noteId: 'note', paragraphId: 'p', appId: 'app', index: 0, data: 'late' });
    expect(service.apps('note', 'p')).toEqual([]);
    expect(service.apps('next', 'p')).toEqual([]);
    send(OP.PARAGRAPH_ADDED, { paragraph: { id: 'new-p', apps: [state('new')] }, index: 2 });
    expect(service.apps('next', 'new-p')[0].output).toBe('new');
    send(OP.PARAGRAPH_REMOVED, { id: 'new-p' });
    expect(service.apps('next', 'new-p')).toEqual([]);
  });

  it('restores application angular objects, replaces values, removes them and clears on note change', () => {
    const { service, send, note } = setup();
    const angularObject = { noteId: 'note', paragraphId: 'app', name: 'count', object: { count: 1 } };
    note('note', [state()], { group: [angularObject, { ...angularObject, paragraphId: 'other-app' }] });
    expect(service.objects('note', 'app')).toEqual([
      { noteId: 'note', paragraphId: 'app', interpreterGroupId: 'group', angularObject }
    ]);
    const update: AngularObjectUpdate = {
      noteId: 'note',
      paragraphId: 'app',
      interpreterGroupId: 'group',
      angularObject: { ...angularObject, object: [1, 2] }
    };
    send(OP.ANGULAR_OBJECT_UPDATE, update);
    send(OP.ANGULAR_OBJECT_UPDATE, { ...update, noteId: 'other-note' });
    send(OP.ANGULAR_OBJECT_REMOVE, { noteId: 'other-note', paragraphId: 'app', name: 'count' });
    expect(service.objects('note', 'app')).toEqual([update]);
    send(OP.ANGULAR_OBJECT_REMOVE, { noteId: 'note', paragraphId: 'app', name: 'count' });
    expect(service.objects('note', 'app')).toEqual([]);
    expect(service.objects('note', 'other-app')).toHaveLength(1);
    note('next', []);
    expect(service.objects('note', 'other-app')).toEqual([]);
    expect(service.objects('next', 'other-app')).toEqual([]);
  });

  it('retains distinct interpreter groups and clears app objects when a paragraph is removed', () => {
    const { service, send, note } = setup();
    const angularObject = { noteId: 'note', paragraphId: 'app', name: 'count', object: 1 };
    note('note', [state()], { first: [angularObject], second: [{ ...angularObject, object: 2 }] });
    expect(service.objects('note', 'app')).toHaveLength(2);
    send(OP.PARAGRAPH_REMOVED, { id: 'p' });
    expect(service.objects('note', 'app')).toEqual([]);
  });

  it('subscribes once and stops receiving until restarted', () => {
    const { service, send, note } = setup();
    service.start();
    note();
    send(OP.APP_APPEND_OUTPUT, { noteId: 'note', paragraphId: 'p', appId: 'app', index: 0, data: '+' });
    expect(service.apps('note', 'p')[0].output).toBe('saved+');
    service.stop();
    note();
    expect(service.apps('note', 'p')).toEqual([]);
    service.start();
    note();
    expect(service.apps('note', 'p')).toEqual([state()]);
    send(OP.NOTE, {});
    expect(service.apps('note', 'p')).toEqual([]);
  });

  it('uses context-aware REST URLs and propagates load failures without inventing state', async () => {
    const { service, get, post } = setup();
    expect(await firstValueFrom(service.suggest('note/a', 'p b'))).toEqual({ available: [{ pkg }] });
    expect(get).toHaveBeenCalledWith('/zeppelin/api/helium/suggest/note%2Fa/p%20b');
    expect(await firstValueFrom(service.load('note/a', 'p b', pkg))).toBe('app');
    expect(post).toHaveBeenCalledWith('/zeppelin/api/helium/load/note%2Fa/p%20b', pkg);
    post.mockReturnValue(throwError(() => new Error('failed to load')));
    await expect(firstValueFrom(service.load('note', 'p', pkg))).rejects.toThrow('failed to load');
    expect(service.apps('note', 'p')).toEqual([]);
  });
});
