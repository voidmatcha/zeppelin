/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AngularObjectUpdated, ParagraphItem } from '@zeppelin/sdk';
import * as angular from 'angular';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HeliumApplicationRuntimeHandle, HeliumApplicationRuntimeService } from './helium-application-runtime.service';

describe('HeliumApplicationRuntimeService', () => {
  let element: HTMLElement;
  let handle: HeliumApplicationRuntimeHandle;
  let changes: AngularObjectUpdated[];

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    changes = [];
    handle = new HeliumApplicationRuntimeService().mount(
      element,
      'app-1',
      { id: 'paragraph-1', results: { code: 'SUCCESS', msg: [] } } as ParagraphItem,
      change => changes.push(change)
    );
  });

  afterEach(() => {
    handle.destroy();
    element.remove();
  });

  it('compiles AngularJS bindings and runs inline application scripts with the $z scope contract', () => {
    handle.render(`
      <span id="bound-value" ng-bind="label"></span>
      <script id="app_js_test">
        (function() {
          const $z = { scope: angular.element('#app_js_test').scope() };
          $z.scope.label = 'rendered';
          $z.scope.contractResult = $z.scope.$parent.paragraph.result;
        })();
      </script>
    `);

    const scope = angular.element(element.querySelector('#app_js_test')).scope() as angular.IScope & {
      contractResult: unknown;
    };
    expect(element.querySelector('#bound-value')?.textContent).toBe('rendered');
    expect(scope.contractResult).toEqual({ code: 'SUCCESS', msg: [] });
  });

  it('destroys the previous view scope while retaining application script state across renders', () => {
    handle.render(`
      <span id="first-view" ng-bind="counter"></span>
      <script id="first-script">
        const $z = { scope: angular.element('#first-script').scope() };
        $z.scope.counter = 1;
      </script>
    `);
    const firstViewScope = angular.element(element.querySelector('#first-view')).scope();
    const firstApplicationScope = angular.element(element.querySelector('#first-script')).scope();

    handle.render(`
      <span id="second-view" ng-bind="counter"></span>
      <script id="second-script">
        const $z = { scope: angular.element('#second-script').scope() };
        $z.scope.counter += 1;
      </script>
    `);

    expect(firstViewScope.$$destroyed).toBe(true);
    expect(angular.element(element.querySelector('#second-view')).scope()).not.toBe(firstViewScope);
    expect(angular.element(element.querySelector('#second-script')).scope()).toBe(firstApplicationScope);
    expect(element.querySelector('#second-view')?.textContent).toBe('2');
  });

  it('rejects external scripts explicitly instead of silently omitting application behavior', () => {
    expect(() => handle.render('<script src="https://example.test/helium-app.js"></script>')).toThrow(
      'External Helium application scripts are not supported: https://example.test/helium-app.js'
    );
  });

  it('suppresses the inbound AngularObject echo and emits later local binding changes', () => {
    handle.render('<input id="bound-input" ng-model="sharedValue">');
    handle.updateObject({
      noteId: 'note-1',
      paragraphId: 'app-1',
      interpreterGroupId: 'group-1',
      angularObject: { name: 'sharedValue', object: 'server', noteId: 'note-1', paragraphId: 'app-1' }
    });

    expect((element.querySelector('#bound-input') as HTMLInputElement).value).toBe('server');
    expect(changes).toEqual([]);

    const scope = angular.element(element.querySelector('#bound-input')).scope() as angular.IScope & {
      sharedValue: string;
    };
    scope.sharedValue = 'browser';
    scope.$apply();
    expect(changes).toEqual([
      {
        noteId: 'note-1',
        paragraphId: 'app-1',
        name: 'sharedValue',
        value: 'browser',
        interpreterGroupId: 'group-1'
      }
    ]);
  });

  it.each([null, undefined])('registers an initially %s AngularObject without echoing it', initialValue => {
    handle.render('<span id="nullable" ng-bind="nullable"></span>');
    handle.updateObject({
      noteId: 'note-1',
      paragraphId: 'app-1',
      interpreterGroupId: 'group-1',
      angularObject: { name: 'nullable', object: initialValue, noteId: 'note-1', paragraphId: 'app-1' }
    });
    expect(changes).toEqual([]);

    const scope = angular.element(element.querySelector('#nullable')).scope() as angular.IScope & {
      nullable: unknown;
    };
    scope.nullable = 'browser';
    scope.$apply();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ name: 'nullable', value: 'browser' });
  });

  it('keeps the Classic shallow-watch contract for in-place object mutations', () => {
    handle.render('<span id="object-binding"></span>');
    handle.updateObject({
      noteId: 'note-1',
      paragraphId: 'app-1',
      interpreterGroupId: 'group-1',
      angularObject: {
        name: 'sharedObject',
        object: { nested: { value: 'server' } },
        noteId: 'note-1',
        paragraphId: 'app-1'
      }
    });
    const scope = angular.element(element.querySelector('#object-binding')).scope() as angular.IScope & {
      sharedObject: { nested: { value: string } };
    };

    scope.sharedObject.nested.value = 'mutated in place';
    scope.$apply();
    expect(changes).toEqual([]);

    scope.sharedObject = { nested: { value: 'replacement' } };
    scope.$apply();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ name: 'sharedObject', value: { nested: { value: 'replacement' } } });
  });

  it('creates and removes AngularFunction proxies', () => {
    handle.render('<button id="invoke" ng-click="greet(\'hello\', 7)">Invoke</button>');
    handle.updateObject({
      noteId: 'note-1',
      paragraphId: 'app-1',
      interpreterGroupId: 'group-1',
      angularObject: {
        name: '_Z_ANGULAR_FUNC_greet',
        object: null,
        noteId: 'note-1',
        paragraphId: 'app-1'
      }
    });

    (element.querySelector('#invoke') as HTMLButtonElement).click();
    expect(changes[0].name).toBe('_Z_ANGULAR_FUNC_greet');
    expect(Array.from(changes[0].value as ArrayLike<unknown>)).toEqual(['hello', 7]);

    handle.removeObject({ noteId: 'note-1', paragraphId: 'app-1', name: '_Z_ANGULAR_FUNC_greet' });
    const scope = angular.element(element.querySelector('#invoke')).scope() as angular.IScope & { greet?: unknown };
    expect(scope.greet).toBeUndefined();
  });

  it('ignores other applications and stops bindings and callbacks after destroy', () => {
    handle.render('<span id="bound-value" ng-bind="value"></span>');
    handle.updateObject({
      noteId: 'note-1',
      paragraphId: 'another-app',
      interpreterGroupId: 'group-1',
      angularObject: { name: 'value', object: 'ignored', noteId: 'note-1', paragraphId: 'another-app' }
    });
    expect(element.querySelector('#bound-value')?.textContent).toBe('');

    handle.destroy();
    handle.render('<span>late</span>');
    handle.updateObject({
      noteId: 'note-1',
      paragraphId: 'app-1',
      interpreterGroupId: 'group-1',
      angularObject: { name: 'value', object: 1, noteId: 'note-1', paragraphId: 'app-1' }
    });
    expect(element.childElementCount).toBe(0);
    expect(changes).toEqual([]);

    const remounted = new HeliumApplicationRuntimeService().mount(
      element,
      'app-2',
      { id: 'paragraph-1', results: { code: 'SUCCESS', msg: [] } } as ParagraphItem,
      change => changes.push(change)
    );
    remounted.render('<span id="remounted" ng-bind="value"></span>');
    remounted.updateObject({
      noteId: 'note-1',
      paragraphId: 'app-2',
      interpreterGroupId: 'group-1',
      angularObject: { name: 'value', object: 'fresh', noteId: 'note-1', paragraphId: 'app-2' }
    });
    expect(element.querySelector('#remounted')?.textContent).toBe('fresh');
    remounted.destroy();
  });
});
