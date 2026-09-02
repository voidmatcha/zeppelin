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

import { createNotebookCore } from '@zeppelin/notebook-core';
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NotebookCoreAdapter } from './NotebookCoreAdapter';

describe('NotebookCoreAdapter', () => {
  it('projects the shared Core snapshot and dispatches a run command through its Port', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({ noteId: 'note-1', dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Shared notebook',
      paragraphs: [{ id: 'paragraph-1', text: '%python\nprint(1)', status: 'READY' }]
    });

    render(<NotebookCoreAdapter core={runtime.port} expectedCore={runtime.port} />);

    const adapter = screen.getByRole('region', { name: 'React Notebook Core proof' });
    expect(adapter.getAttribute('data-port-shared')).toBe('true');
    expect(adapter.getAttribute('data-note-id')).toBe('note-1');
    expect(adapter.getAttribute('data-title')).toBe('Shared notebook');
    expect(adapter.getAttribute('data-paragraph-count')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Run first paragraph from React' }));

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenCalledWith({ type: 'run-paragraph', paragraphId: 'paragraph-1' });
    expect(adapter.getAttribute('data-command-accepted')).toBe('true');

    act(() => {
      runtime.apply({ type: 'paragraph-updated', paragraphId: 'paragraph-1', status: 'FINISHED' });
    });
    expect(adapter.getAttribute('data-paragraph-statuses')).toBe(JSON.stringify(['FINISHED']));
  });

  it('disables execution for revision snapshots', () => {
    const runtime = createNotebookCore({ noteId: 'note-1', revisionId: 'revision-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: 'revision-1',
      title: 'Historical notebook',
      paragraphs: [{ id: 'paragraph-1', text: '%python\nprint(1)', status: 'READY' }]
    });

    render(<NotebookCoreAdapter core={runtime.port} expectedCore={runtime.port} />);

    expect((screen.getByRole('button', { name: 'Run first paragraph from React' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
