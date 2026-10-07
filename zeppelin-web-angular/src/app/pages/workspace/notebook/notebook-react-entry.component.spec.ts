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

import { NotebookCoreReadHost } from './notebook-core-read-host';
import { NotebookReactEntryComponent } from './notebook-react-entry.component';

describe('NotebookReactEntryComponent', () => {
  it('falls back through the host for errors after the React route has mounted', () => {
    const entry = new NotebookReactEntryComponent();
    const onEntryFailure = vi.fn();
    const port = { getSnapshot: vi.fn(), subscribe: vi.fn() };
    entry.onEntryFailure = onEntryFailure;
    entry.host = { port } as unknown as NotebookCoreReadHost;

    expect(entry.reactProps.core).toBe(port);
    (entry.reactProps.onError as (error: unknown) => void)(new Error('chart rendering failed'));
    expect(onEntryFailure).toHaveBeenCalledOnce();
  });
});
