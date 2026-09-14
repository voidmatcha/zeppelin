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

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NotebookParagraphResult, NotebookParagraphResultConfigs } from '@zeppelin/notebook-core';
import { DatasetType } from '@zeppelin/sdk';
import { SingleResultRenderer } from './SingleResultRenderer';

const result = (type: DatasetType, data: string): NotebookParagraphResult => ({ type, data });

const TABLE_DATA = 'name\tage\nalice\t30';

// Index 0 stays a table, index 1 draws a chart, so reading the wrong entry shows.
const configs = {
  0: { graph: { mode: 'table' } },
  1: { graph: { mode: 'multiBarChart' } }
} as unknown as NotebookParagraphResultConfigs;

describe('SingleResultRenderer', () => {
  it('renders TEXT as text, leaving markup in it literal', () => {
    // Markup in the payload is what separates this arm from HTML: routing TEXT to
    // HTMLRenderer would parse the tag away instead of showing it.
    render(<SingleResultRenderer index={0} result={result(DatasetType.TEXT, 'line one <b>not bold</b>')} />);

    expect(screen.getByText(/line one <b>not bold<\/b>/)).toBeTruthy();
  });

  it('renders TABLE through the visualization', () => {
    render(<SingleResultRenderer index={0} result={result(DatasetType.TABLE, TABLE_DATA)} />);

    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bar Chart/ })).toBeTruthy();
  });

  it('hands the visualization the display config for its own result index', () => {
    // Both indices are rendered: index 1 alone would pass against a hard-coded [1],
    // and the positive assertion keeps an absent chart from reading as success.
    const table = render(
      <SingleResultRenderer index={0} config={configs} result={result(DatasetType.TABLE, TABLE_DATA)} />
    );
    expect(screen.getByText('alice')).toBeTruthy();
    table.unmount();

    render(<SingleResultRenderer index={1} config={configs} result={result(DatasetType.TABLE, TABLE_DATA)} />);
    expect(screen.getByRole('button', { name: /Table/ })).toBeTruthy();
    expect(screen.queryByText('alice')).toBeNull();
  });

  it('keeps TABLE output in React when the notebook host callback is available', () => {
    const mount = vi.fn(() => () => undefined);
    render(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.TABLE, 'name\tvalue\nfirst\t1')}
        onHostResultMount={mount}
      />
    );

    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bar Chart/ })).toBeTruthy();
    expect(mount).not.toHaveBeenCalled();
  });

  it('renders IMG as a base64 png', () => {
    render(<SingleResultRenderer index={0} result={result(DatasetType.IMG, 'QUJD')} />);

    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,QUJD');
  });

  it('renders HTML as markup rather than as text', () => {
    render(<SingleResultRenderer index={0} result={result(DatasetType.HTML, '<p>markup output</p>')} />);

    expect(screen.getByText('markup output').tagName).toBe('P');
  });

  it('delegates ANGULAR result lifecycle to the Angular host', () => {
    const cleanup = vi.fn();
    const mount = vi.fn(() => cleanup);
    const { unmount } = render(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{value}}</div>')}
        onHostResultMount={mount}
      />
    );

    expect(mount).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'paragraph-1',
      0,
      result(DatasetType.ANGULAR, '<div>{{value}}</div>'),
      undefined
    );
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps an equivalent host result mounted across unrelated renders', () => {
    const cleanup = vi.fn();
    const mount = vi.fn(() => cleanup);
    const replacementMount = vi.fn(() => cleanup);
    const { rerender, unmount } = render(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{value}}</div>')}
        config={{ 0: { graph: { mode: 'table' } } } as NotebookParagraphResultConfigs}
        onHostResultMount={mount}
      />
    );

    rerender(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{value}}</div>')}
        config={{ 0: { graph: { mode: 'table' } } } as NotebookParagraphResultConfigs}
        onHostResultMount={replacementMount}
      />
    );

    expect(mount).toHaveBeenCalledTimes(1);
    expect(replacementMount).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('remounts the host result when its data or display config changes', () => {
    const cleanup = vi.fn();
    const mount = vi.fn(() => cleanup);
    const { rerender } = render(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{value}}</div>')}
        config={{ 0: { graph: { mode: 'table' } } } as NotebookParagraphResultConfigs}
        onHostResultMount={mount}
      />
    );

    rerender(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{nextValue}}</div>')}
        config={{ 0: { graph: { mode: 'table' } } } as NotebookParagraphResultConfigs}
        onHostResultMount={mount}
      />
    );
    expect(mount).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(1);

    rerender(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{nextValue}}</div>')}
        config={{ 0: { graph: { mode: 'multiBarChart' } } } as NotebookParagraphResultConfigs}
        onHostResultMount={mount}
      />
    );
    expect(mount).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('gives every host mount a fresh element without losing the React-owned container', () => {
    const mount = vi.fn((_host: unknown) => () => undefined);
    const { rerender } = render(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{value}}</div>')}
        onHostResultMount={mount}
      />
    );
    const container = screen.getByLabelText('Host result');
    const firstHost = mount.mock.calls[0][0] as HTMLElement;

    rerender(
      <SingleResultRenderer
        index={0}
        paragraphId="paragraph-1"
        result={result(DatasetType.ANGULAR, '<div>{{nextValue}}</div>')}
        onHostResultMount={mount}
      />
    );

    const secondHost = mount.mock.calls[1][0] as HTMLElement;
    expect(secondHost).not.toBe(firstHost);
    expect(container.isConnected).toBe(true);
    expect(container.firstElementChild).toBe(secondHost);
    expect(firstHost.isConnected).toBe(false);
  });

  it('renders nothing for a type it has no renderer for', () => {
    // NETWORK is declared by the SDK and reaches the default arm.
    const { container } = render(<SingleResultRenderer index={0} result={result(DatasetType.NETWORK, 'graph')} />);

    expect(container.innerHTML).toBe('');
  });
});
