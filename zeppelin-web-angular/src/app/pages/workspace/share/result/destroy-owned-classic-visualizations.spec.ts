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

import { describe, expect, it, vi } from 'vitest';

import { destroyOwnedClassicVisualizations } from './destroy-owned-classic-visualizations';

describe('destroyOwnedClassicVisualizations', () => {
  it('destroys only instances owned by the departing paragraph', () => {
    const activeInstances = new Set(['pparagraph-1_plugin', 'pparagraph-2_plugin']);
    const destroyInstance = vi.fn((targetElementId: string) => activeInstances.delete(targetElementId));
    const visualizations = [{ id: 'plugin', isClassic: true, instance: {} }];

    destroyOwnedClassicVisualizations('paragraph-1', visualizations, undefined, destroyInstance);

    expect(destroyInstance).toHaveBeenCalledWith('pparagraph-1_plugin');
    expect(activeInstances).toEqual(new Set(['pparagraph-2_plugin']));
    expect(visualizations[0].instance).toBeUndefined();
  });
});
