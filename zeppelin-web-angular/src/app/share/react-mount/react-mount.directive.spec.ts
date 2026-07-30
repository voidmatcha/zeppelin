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

import { ElementRef, NgZone, SimpleChanges } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ReactMountDirective } from './react-mount.directive';
import { ReactExposedModule, ReactHostCallbacks, ReactProps } from './react-mount-handle';

describe('ReactMountDirective zone re-entry', () => {
  it('re-enters the Angular zone for a callback the remote invokes itself', async () => {
    const host = new ElementRef(document.createElement('div'));
    const ngZone = new NgZone({ enableLongStackTrace: false });

    let capturedProps: (ReactProps & ReactHostCallbacks) | null = null;
    const fakeModule: ReactExposedModule = {
      mount: (_el, props) => {
        capturedProps = props as ReactProps & ReactHostCallbacks;
        return { update: () => undefined, unmount: () => undefined };
      }
    };
    const loader = { loadModule: () => Promise.resolve(fakeModule) };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const directive = new ReactMountDirective(host, ngZone, loader as any);
    directive.module = './Fake';

    let sawAngularZone: boolean | null = null;
    directive.reactProps = {
      onError: () => {
        sawAngularZone = NgZone.isInAngularZone();
      }
    };

    directive.ngOnChanges({} as SimpleChanges);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(capturedProps).not.toBeNull();

    // React lifecycle (e.g. an error boundary) runs outside the zone, because the directive mounted there. This is what
    // ReactErrorBoundary does.
    ngZone.runOutsideAngular(() => capturedProps!.onError!(new Error('boom')));

    expect(sawAngularZone).toBe(true);
  });
});
