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

vi.mock('./NotebookMonacoEditor', () => ({
  NotebookMonacoEditor: ({
    ariaLabel,
    disabled,
    onChange,
    value
  }: {
    ariaLabel: string;
    disabled: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => <textarea aria-label={ariaLabel} disabled={disabled} onChange={event => onChange(event.target.value)} value={value} />
}));

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

    const adapter = screen.getByRole('region', { name: 'React Notebook' });
    expect(adapter.getAttribute('data-port-shared')).toBe('true');
    expect(adapter.getAttribute('data-note-id')).toBe('note-1');
    expect(adapter.getAttribute('data-title')).toBe('Shared notebook');
    expect(adapter.getAttribute('data-paragraph-count')).toBe('1');
    expect(screen.getByRole('article', { name: 'Paragraph 1' }).textContent).toContain('%python\nprint(1)');
    expect(screen.getByRole('article', { name: 'Paragraph 1' }).textContent).toContain('READY');

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenCalledWith({ type: 'run-paragraph', paragraphId: 'paragraph-1' });
    expect(adapter.getAttribute('data-command-accepted')).toBe('true');

    act(() => {
      runtime.apply({ type: 'paragraph-updated', paragraphId: 'paragraph-1', status: 'FINISHED' });
    });
    expect(adapter.getAttribute('data-paragraph-statuses')).toBe(JSON.stringify(['FINISHED']));
    expect(screen.getByRole('article', { name: 'Paragraph 1' }).textContent).toContain('FINISHED');
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

    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a local title draft until a Core title update arrives', () => {
    const onNotebookTitleChange = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Original title',
      paragraphs: []
    });

    render(<NotebookCoreAdapter core={runtime.port} onNotebookTitleChange={onNotebookTitleChange} />);

    const title = screen.getByRole('textbox', { name: 'Notebook title' }) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Local title' } });
    fireEvent.blur(title);
    expect(title.value).toBe('Local title');
    expect(onNotebookTitleChange).toHaveBeenCalledWith('Local title');

    act(() => {
      runtime.apply({ type: 'note-updated', title: 'Remote title' });
    });
    expect(title.value).toBe('Remote title');
  });

  it('keeps a local paragraph draft until a Core paragraph update arrives', () => {
    const onParagraphTextChange = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: [{ id: 'paragraph-1', text: '%python\nprint("original")', status: 'READY' }]
    });

    render(<NotebookCoreAdapter core={runtime.port} onParagraphTextChange={onParagraphTextChange} />);

    const editor = screen.getByRole('textbox', { name: 'Paragraph 1 editor' }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '%python\nprint("local")' } });
    expect(editor.value).toBe('%python\nprint("local")');
    expect(onParagraphTextChange).toHaveBeenCalledWith('paragraph-1', '%python\nprint("local")');

    act(() => {
      runtime.apply({ type: 'paragraph-updated', paragraphId: 'paragraph-1', text: '%python\nprint("remote")' });
    });
    expect(editor.value).toBe('%python\nprint("remote")');
  });

  it('honors the host read-only capability for notebook mutations', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Read-only notebook',
      noteForms: {
        region: {
          name: 'region',
          displayName: 'Region',
          type: 'Select',
          defaultValue: 'us-east-1',
          hidden: false,
          options: [{ value: 'us-east-1' }]
        }
      },
      noteParams: { region: 'us-east-1' },
      paragraphs: [{ id: 'paragraph-1', text: '%python\nprint(1)', status: 'READY' }]
    });

    render(<NotebookCoreAdapter core={runtime.port} readOnly />);

    expect((screen.getByRole('textbox', { name: 'Notebook title' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Region' }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Paragraph 1 editor' }) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add below' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders note forms and sends changed values through the host callback', () => {
    const onNoteFormsChange = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Shared notebook',
      noteForms: {
        region: {
          name: 'region',
          displayName: 'Region',
          type: 'Select',
          defaultValue: 'us-east-1',
          hidden: false,
          options: [{ value: 'us-east-1' }, { value: 'ap-northeast-2', displayName: 'Seoul' }]
        }
      },
      noteParams: { region: 'us-east-1' },
      paragraphs: []
    });

    render(<NotebookCoreAdapter core={runtime.port} onNoteFormsChange={onNoteFormsChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Region' }), { target: { value: 'ap-northeast-2' } });

    expect(onNoteFormsChange).toHaveBeenCalledWith({ region: 'ap-northeast-2' });
  });

  it('uses the React result renderer for Core-owned output', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Result notebook',
      paragraphs: [
        { id: 'paragraph-1', text: '%python', status: 'FINISHED', results: [{ type: 'TEXT', data: 'answer' }] }
      ]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);

    expect(screen.getByTestId('react-notebook-core-results').textContent).toContain('answer');
    expect(screen.getByTestId('react-notebook-core-result').querySelector('pre')).not.toBeNull();
  });

  it('uses the Core result configuration when selecting a React visualization mode', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Configured result notebook',
      paragraphs: [
        {
          id: 'paragraph-1',
          text: '%python',
          status: 'FINISHED',
          results: [{ type: 'TABLE', data: 'name\tvalue\nZeppelin\t1' }],
          resultConfigs: { '0': { graph: { mode: 'lineChart' } } }
        }
      ]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);

    expect(screen.getByRole('button', { name: /Line Chart$/ }).className).toContain('ant-btn-primary');
  });

  it('renders Core-owned progress for a running paragraph', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Running notebook',
      paragraphs: [{ id: 'paragraph-1', text: '%python', status: 'RUNNING', progress: 55 }]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);

    expect((screen.getByRole('progressbar', { name: 'Paragraph 1 progress' }) as HTMLProgressElement).value).toBe(55);
  });

  it('preserves unsupported Core output instead of dropping it', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Unknown result notebook',
      paragraphs: [
        { id: 'paragraph-1', text: '%python', status: 'FINISHED', results: [{ type: 'NETWORK', data: 'graph' }] }
      ]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);

    expect(screen.getByTestId('react-notebook-core-result').textContent).toContain('graph');
  });
});
