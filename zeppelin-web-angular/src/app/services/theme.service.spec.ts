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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editor } from 'monaco-editor';

import { ThemeService } from './theme.service';

vi.mock('monaco-editor', () => ({ editor: { setTheme: vi.fn() } }));

describe('ThemeService', () => {
  let service: ThemeService | undefined;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('monaco', undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    service?.ngOnDestroy();
    service = undefined;
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('applies the saved dark theme without a global Monaco object', () => {
    localStorage.setItem('zeppelin-theme', 'dark');
    service = new ThemeService();

    expect(editor.setTheme).toHaveBeenCalledWith('vs-dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('updates Monaco when cycling from light to dark', () => {
    localStorage.setItem('zeppelin-theme', 'light');
    service = new ThemeService();
    service.toggleTheme();

    expect(editor.setTheme).toHaveBeenLastCalledWith('vs-dark');
    expect(service.getCurrentTheme()).toBe('dark');
    expect(localStorage.getItem('zeppelin-theme')).toBe('dark');
  });
});
