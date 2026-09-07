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
    language,
    searchTerm,
    onChange,
    value
  }: {
    ariaLabel: string;
    disabled: boolean;
    language?: string;
    searchTerm?: string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      data-language={language}
      data-search-term={searchTerm}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      value={value}
    />
  )
}));

import { mount, NotebookCoreAdapter } from './NotebookCoreAdapter';

describe('NotebookCoreAdapter', () => {
  it('mounts inside the host theme provider', () => {
    const runtime = createNotebookCore({ noteId: 'note-1', dispatchCommand: () => true });
    const element = document.createElement('div');
    document.body.appendChild(element);
    document.documentElement.setAttribute('data-theme', 'dark');

    let handle: ReturnType<typeof mount>;
    act(() => {
      handle = mount(element, { core: runtime.port });
    });

    expect(element.querySelector('[data-testid="notebook-core-react-adapter"]')?.getAttribute('data-host-theme')).toBe(
      'dark'
    );

    act(() => {
      handle.unmount();
    });
    element.remove();
    document.documentElement.removeAttribute('data-theme');
  });

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

  it('dispatches React notebook-wide execution and cancellation through the shared Port', () => {
    const dispatchCommand = vi.fn(() => true);
    const runtime = createNotebookCore({ noteId: 'note-1', dispatchCommand });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: [{ id: 'paragraph-1', text: '%python\nprint(1)', status: 'READY' }]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run all' }));
    expect(dispatchCommand).toHaveBeenLastCalledWith({ type: 'run-all-paragraphs' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear all output' }));
    expect(dispatchCommand).toHaveBeenLastCalledWith({ type: 'clear-all-paragraph-output' });

    act(() => {
      runtime.apply({ type: 'paragraph-updated', paragraphId: 'paragraph-1', status: 'RUNNING' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all' }));
    expect(dispatchCommand).toHaveBeenLastCalledWith({ type: 'cancel-all-paragraphs' });
  });

  it('renders collaboration presence from the shared Core snapshot', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: []
    });
    runtime.apply({ type: 'collaboration-updated', users: ['alice', 'bob'] });

    render(<NotebookCoreAdapter core={runtime.port} />);
    expect(screen.getByLabelText('Collaborators').textContent).toBe('Collaborators: 2');

    act(() => {
      runtime.apply({ type: 'collaboration-updated', users: null });
    });
    expect(screen.queryByLabelText('Collaborators')).toBeNull();
  });

  it('reads notebook permissions from the shared Core snapshot', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({ type: 'note-loaded', noteId: 'note-1', revisionId: null, title: 'Notebook', paragraphs: [] });
    runtime.apply({
      type: 'permissions-updated',
      permissions: { readers: [], owners: ['owner'], writers: [], runners: [] }
    });

    render(<NotebookCoreAdapter core={runtime.port} />);
    expect(screen.getByRole('region', { name: 'React Notebook' }).getAttribute('data-permission-owner-count')).toBe(
      '1'
    );
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
    expect((screen.getByRole('button', { name: 'Run all' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Clear all output' }) as HTMLButtonElement).disabled).toBe(true);
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

  it('delegates notebook reload and extension selection to the host', () => {
    const onCloneNotebook = vi.fn();
    const onExportNotebook = vi.fn();
    const onReloadNotebook = vi.fn();
    const onExtensionChange = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: []
    });
    render(
      <NotebookCoreAdapter
        core={runtime.port}
        onCloneNotebook={onCloneNotebook}
        onExportNotebook={onExportNotebook}
        onReloadNotebook={onReloadNotebook}
        onExtensionChange={onExtensionChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clone notebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export notebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload notebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Interpreter settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisions' }));

    expect(onCloneNotebook).toHaveBeenCalledTimes(1);
    expect(onExportNotebook).toHaveBeenCalledTimes(1);
    expect(onReloadNotebook).toHaveBeenCalledTimes(1);
    expect(onExtensionChange).toHaveBeenNthCalledWith(1, 'interpreter');
    expect(onExtensionChange).toHaveBeenNthCalledWith(2, 'permissions');
    expect(onExtensionChange).toHaveBeenNthCalledWith(3, 'revisions');
  });

  it('exposes the personalized-mode switch only when the host grants that capability', () => {
    const onTogglePersonalizedMode = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: []
    });

    const view = render(<NotebookCoreAdapter core={runtime.port} />);
    expect(view.queryByRole('button', { name: 'Switch to personal mode' })).toBeNull();
    view.unmount();

    render(
      <NotebookCoreAdapter
        core={runtime.port}
        canTogglePersonalizedMode
        personalizedMode
        onTogglePersonalizedMode={onTogglePersonalizedMode}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch to collaboration mode' }));
    expect(onTogglePersonalizedMode).toHaveBeenCalledTimes(1);
  });

  it('delegates deletion to the host only when the host grants that capability', () => {
    const onDeleteNotebook = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: []
    });

    const view = render(<NotebookCoreAdapter core={runtime.port} />);
    expect(view.queryByRole('button', { name: 'Move notebook to trash' })).toBeNull();
    view.unmount();

    render(<NotebookCoreAdapter core={runtime.port} canDeleteNotebook onDeleteNotebook={onDeleteNotebook} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move notebook to trash' }));
    expect(onDeleteNotebook).toHaveBeenCalledTimes(1);
  });

  it('delegates shortcut and look-and-feel controls to the host', () => {
    const onShowShortcut = vi.fn();
    const onLookAndFeelChange = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: []
    });

    render(
      <NotebookCoreAdapter
        core={runtime.port}
        lookAndFeel="simple"
        onShowShortcut={onShowShortcut}
        onLookAndFeelChange={onLookAndFeelChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Notebook look and feel' }), {
      target: { value: 'report' }
    });

    expect(onShowShortcut).toHaveBeenCalledTimes(1);
    expect(onLookAndFeelChange).toHaveBeenCalledWith('report');
  });

  it('delegates revision selection and checkpoint actions to the host', () => {
    const onRevisionSelect = vi.fn();
    const onCheckpointNotebook = vi.fn();
    const onSetNotebookRevision = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: []
    });
    runtime.apply({
      type: 'revisions-updated',
      revisions: [
        { id: 'Head', message: 'Head' },
        { id: 'revision-1', message: 'before rename', time: 1 }
      ]
    });

    const { rerender } = render(
      <NotebookCoreAdapter
        core={runtime.port}
        onRevisionSelect={onRevisionSelect}
        onCheckpointNotebook={onCheckpointNotebook}
        onSetNotebookRevision={onSetNotebookRevision}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Notebook revision' }), {
      target: { value: 'revision-1' }
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Checkpoint message' }), {
      target: { value: 'before release' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Checkpoint' }));
    expect(onRevisionSelect).toHaveBeenCalledWith('revision-1');
    expect(onCheckpointNotebook).toHaveBeenCalledWith('before release');

    act(() => {
      runtime.apply({ type: 'route-changed', noteId: 'note-1', revisionId: 'revision-1' });
      runtime.apply({ type: 'load-started' });
      runtime.apply({
        type: 'note-loaded',
        noteId: 'note-1',
        revisionId: 'revision-1',
        title: 'Notebook',
        paragraphs: []
      });
      runtime.apply({
        type: 'revisions-updated',
        revisions: [
          { id: 'Head', message: 'Head' },
          { id: 'revision-1', message: 'before rename', time: 1 }
        ]
      });
    });
    rerender(
      <NotebookCoreAdapter
        core={runtime.port}
        onSetNotebookRevision={onSetNotebookRevision}
      />
    );
    expect(screen.queryByRole('textbox', { name: 'Checkpoint message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set revision as head' }));
    expect(onSetNotebookRevision).toHaveBeenCalledTimes(1);
  });

  it('delegates Core scheduler configuration and shows Core collaboration state', () => {
    const onScheduleChange = vi.fn();
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      scheduler: { cron: '0 0/5 * * * ?', releaseResource: false },
      paragraphs: []
    });
    runtime.apply({ type: 'collaboration-updated', users: [] });

    render(
      <NotebookCoreAdapter
        core={runtime.port}
        onScheduleChange={onScheduleChange}
      />
    );

    expect(screen.getByLabelText('Collaborators').textContent).toBe('Collaborators: 0');
    fireEvent.change(screen.getByRole('textbox', { name: 'Cron expression' }), {
      target: { value: '0 0 0/1 * * ?' }
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Release interpreter after schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(onScheduleChange).toHaveBeenCalledWith({ cron: '0 0 0/1 * * ?', releaseResource: true });
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

  it('passes a React notebook search term to every Monaco editor', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Notebook',
      paragraphs: [{ id: 'paragraph-1', text: '%python\nprint("needle")', status: 'READY' }]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search notebook' }), { target: { value: 'needle' } });
    expect(screen.getByRole('textbox', { name: 'Paragraph 1 editor' }).getAttribute('data-search-term')).toBe('needle');
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
      paragraphs: [
        {
          id: 'paragraph-1',
          text: '%python\nprint(1)',
          status: 'READY',
          results: [{ type: 'TABLE', data: 'name\tvalue\nZeppelin\t1' }]
        }
      ]
    });

    render(<NotebookCoreAdapter core={runtime.port} readOnly />);

    expect((screen.getByRole('textbox', { name: 'Notebook title' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Region' }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Paragraph 1 editor' }) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add below' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Line Chart$/ }) as HTMLButtonElement).disabled).toBe(true);
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

  it('toggles React code and output visibility without changing the shared notebook state', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'Display notebook',
      paragraphs: [
        {
          id: 'paragraph-1',
          text: '%python\nprint(1)',
          status: 'FINISHED',
          results: [{ type: 'TEXT', data: 'answer' }]
        }
      ]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);
    expect(screen.getByRole('textbox', { name: 'Paragraph 1 editor' })).toBeTruthy();
    expect(screen.getByTestId('react-notebook-core-results')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide output' }));
    expect(screen.queryByRole('textbox', { name: 'Paragraph 1 editor' })).toBeNull();
    expect(screen.queryByTestId('react-notebook-core-results')).toBeNull();
    expect(runtime.port.getSnapshot().paragraphs[0].text).toBe('%python\nprint(1)');

    fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show output' }));
    expect(screen.getByRole('textbox', { name: 'Paragraph 1 editor' })).toBeTruthy();
    expect(screen.getByTestId('react-notebook-core-results')).toBeTruthy();
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

  it('sends a changed result mode through the host callback', () => {
    const onParagraphResultConfigChange = vi.fn();
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
          resultConfigs: { '0': { graph: { mode: 'table' } } }
        }
      ]
    });

    render(<NotebookCoreAdapter core={runtime.port} onParagraphResultConfigChange={onParagraphResultConfigChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Line Chart$/ }));

    expect(onParagraphResultConfigChange).toHaveBeenCalledWith('paragraph-1', 0, { graph: { mode: 'lineChart' } });
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

  it('passes the Core editor language to Monaco', () => {
    const runtime = createNotebookCore({ noteId: 'note-1' });
    runtime.apply({ type: 'load-started' });
    runtime.apply({
      type: 'note-loaded',
      noteId: 'note-1',
      revisionId: null,
      title: 'SQL notebook',
      paragraphs: [{ id: 'paragraph-1', text: '%sql\nselect 1', status: 'READY', language: 'sql' }]
    });

    render(<NotebookCoreAdapter core={runtime.port} />);

    expect(screen.getByRole('textbox', { name: 'Paragraph 1 editor' }).getAttribute('data-language')).toBe('sql');
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
