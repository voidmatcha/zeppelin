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

import { ClassicVisualizationService } from './classic-visualization.service';

describe('ClassicVisualizationService paragraph cleanup', () => {
  it('does not destroy visualizations belonging to another paragraph', () => {
    const service = Object.create(ClassicVisualizationService.prototype) as ClassicVisualizationService;
    const activeInstances = new Map<string, unknown>([
      ['pnote_1_vis', {}],
      ['pnote_1_other', {}],
      ['pnote_10_vis', {}]
    ]);
    Object.assign(service, { activeInstanceInfos: activeInstances });
    const destroy = vi.spyOn(service, 'destroyInstance').mockImplementation(() => {});

    service.destroyInstancesForParagraph('note_1', true);

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledWith('pnote_1_vis', true);
    expect(destroy).toHaveBeenCalledWith('pnote_1_other', true);
    expect(destroy).not.toHaveBeenCalledWith('pnote_10_vis', true);
  });
});
