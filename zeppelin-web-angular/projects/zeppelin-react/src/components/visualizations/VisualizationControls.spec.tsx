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

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VisualizationControls } from './VisualizationControls';

describe('VisualizationControls', () => {
  it('keeps export actions available when display-mode changes are disabled', () => {
    const onModeChange = vi.fn();
    const onExport = vi.fn();
    render(
      <VisualizationControls
        currentMode="table"
        modeChangeDisabled
        onModeChange={onModeChange}
        onExport={onExport}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Bar Chart/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export Excel/ }));

    expect(onModeChange).not.toHaveBeenCalled();
    expect(onExport).toHaveBeenNthCalledWith(1, 'csv');
    expect(onExport).toHaveBeenNthCalledWith(2, 'xlsx');
  });
});
