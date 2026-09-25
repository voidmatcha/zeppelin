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

import { Injectable } from '@angular/core';
import { AngularObjectRemove, AngularObjectUpdate, AngularObjectUpdated, ParagraphItem } from '@zeppelin/sdk';
import * as angular from 'angular';

const ANGULAR_FUNCTION_OBJECT_NAME_PREFIX = '_Z_ANGULAR_FUNC_';

interface AngularObjectRegistration {
  interpreterGroupId: string;
  noteId: string;
  paragraphId: string;
  skipEmit: boolean;
  clearWatcher: () => void;
}

export interface HeliumApplicationRuntimeHandle {
  render(html: string): void;
  updateObject(data: AngularObjectUpdate): void;
  removeObject(data: AngularObjectRemove): void;
  destroy(): void;
}

@Injectable({
  providedIn: 'root'
})
export class HeliumApplicationRuntimeService {
  private static nextRuntimeId = 0;

  mount(
    element: HTMLElement,
    appId: string,
    paragraph: ParagraphItem,
    onObjectChange: (data: AngularObjectUpdated) => void
  ): HeliumApplicationRuntimeHandle {
    const moduleName = `heliumApplicationRuntime_${HeliumApplicationRuntimeService.nextRuntimeId++}`;
    angular.module(moduleName, []);
    const injector = angular.bootstrap(element, [moduleName]);
    const rootScope = injector.get<angular.IRootScopeService>('$rootScope');
    const compile = injector.get<angular.ICompileService>('$compile');
    const parentScope = rootScope.$new();
    const applicationScope = parentScope.$new(true);
    const applicationValues = applicationScope as angular.IScope & Record<string, unknown>;
    const registrations = new Map<string, AngularObjectRegistration>();
    let viewScope: angular.IScope | undefined;
    let destroyed = false;

    // Application.beginJavascript() resolves `$z.result` through this exact Classic UI shape.
    const compatibilityParagraph = paragraph as ParagraphItem & { result?: unknown };
    compatibilityParagraph.result = paragraph.results;
    (parentScope as angular.IScope & { paragraph: typeof compatibilityParagraph }).paragraph = compatibilityParagraph;

    const digest = () => {
      if (!rootScope.$$phase) {
        rootScope.$digest();
      }
    };

    const clearView = () => {
      viewScope?.$destroy();
      viewScope = undefined;
      angular.element(element).children().remove();
      element.textContent = '';
    };

    const forwardApplicationValue = (name: string) => {
      if (!viewScope || Object.prototype.hasOwnProperty.call(viewScope, name)) {
        return;
      }
      Object.defineProperty(viewScope, name, {
        configurable: true,
        get: () => applicationValues[name],
        set: value => {
          applicationValues[name] = value;
        }
      });
    };

    const render = (html: string) => {
      if (destroyed) {
        return;
      }
      clearView();
      viewScope = applicationScope.$new();
      for (const name of registrations.keys()) {
        forwardApplicationValue(name);
      }
      element.innerHTML = html;
      compile(angular.element(element).contents() as unknown as JQuery<HTMLElement>)(viewScope);
      digest();

      const runtimeAngular = new Proxy(angular, {
        get: (target, property) => {
          if (property === 'element') {
            return (value: string | Element) => {
              const selected = typeof value === 'string' ? document.querySelector(value) : value;
              return angular.element(selected ?? []);
            };
          }
          return Reflect.get(target, property);
        }
      });

      // Scripts inserted through innerHTML are inert. Zeppelin applications intentionally emit
      // trusted executable output, so run them after $compile has associated their DOM nodes with
      // the application scope used by `angular.element('#app_js_...').scope()`.
      for (const script of Array.from(element.querySelectorAll('script'))) {
        if (script.src) {
          throw new Error(`External Helium application scripts are not supported: ${script.src}`);
        }
        if (script.type && script.type !== 'text/javascript' && script.type !== 'application/javascript') {
          continue;
        }
        // The disposable view scope owns template watchers. Server scripts keep the stable
        // application scope that Classic Helium retained across output replacements.
        angular.element(script).data('$scope', applicationScope);
        const execute = new Function('angular', script.textContent ?? '');
        execute(runtimeAngular);
      }
      digest();
    };

    const updateObject = (data: AngularObjectUpdate) => {
      if (destroyed || data.paragraphId !== appId) {
        return;
      }
      const { name, object } = data.angularObject;
      if (registrations.has(name) && angular.equals(applicationValues[name], object)) {
        return;
      }

      let registration = registrations.get(name);
      if (!registration) {
        const created: AngularObjectRegistration = {
          interpreterGroupId: data.interpreterGroupId,
          noteId: data.noteId,
          paragraphId: data.paragraphId,
          skipEmit: true,
          clearWatcher: () => undefined
        };
        created.clearWatcher = applicationScope.$watch(name, newValue => {
          if (created.skipEmit) {
            created.skipEmit = false;
            return;
          }
          onObjectChange({
            noteId: created.noteId,
            paragraphId: created.paragraphId,
            name,
            value: newValue,
            interpreterGroupId: created.interpreterGroupId
          });
        });
        registrations.set(name, created);
        registration = created;
        forwardApplicationValue(name);
      } else {
        registration.noteId ||= data.noteId;
        registration.paragraphId ||= data.paragraphId;
        registration.skipEmit = true;
      }

      applicationValues[name] = object;
      if (name.startsWith(ANGULAR_FUNCTION_OBJECT_NAME_PREFIX)) {
        const functionName = name.slice(ANGULAR_FUNCTION_OBJECT_NAME_PREFIX.length);
        // Classic Helium exposes the JavaScript Arguments object, not a copied array.
        // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
        applicationValues[functionName] = function () {
          applicationValues[name] = arguments;
        };
      }
      digest();
    };

    const removeObject = (data: AngularObjectRemove) => {
      if (destroyed || data.paragraphId !== appId) {
        return;
      }
      const registration = registrations.get(data.name);
      registration?.clearWatcher();
      registrations.delete(data.name);

      if (viewScope) {
        delete (viewScope as angular.IScope & Record<string, unknown>)[data.name];
      }
      applicationValues[data.name] = undefined;
      if (data.name.startsWith(ANGULAR_FUNCTION_OBJECT_NAME_PREFIX)) {
        applicationValues[data.name.slice(ANGULAR_FUNCTION_OBJECT_NAME_PREFIX.length)] = undefined;
      }
      digest();
    };

    const destroy = () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      for (const registration of registrations.values()) {
        registration.clearWatcher();
      }
      registrations.clear();
      clearView();
      applicationScope.$destroy();
      parentScope.$destroy();
      rootScope.$destroy();
      angular.element(element).off().removeData();
    };

    return { render, updateObject, removeObject, destroy };
  }
}
