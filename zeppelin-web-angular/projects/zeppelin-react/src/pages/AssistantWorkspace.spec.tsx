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

import { act } from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react';
import type { AssistantEvent, AssistantTransport } from '@zeppelin/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantWorkspaceMountHandle, AssistantWorkspaceProps, mount } from './AssistantWorkspace';

const emptyRun = async function* (): AsyncIterable<AssistantEvent> {
  yield { type: 'run.completed' };
};

// The workspace builds its conversation transport from `apiBase`; tests swap in spies.
const transportState = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('./assistantTransport', async importOriginal => ({
  ...(await importOriginal<typeof import('./assistantTransport')>()),
  createAssistantTransport: () => transportState.current
}));

const transport = (
  overrides: Partial<AssistantTransport> = {}
): Pick<AssistantWorkspaceProps, 'apiBase' | 'socket'> => {
  transportState.current = {
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn().mockResolvedValue({ id: 'inline-thread', title: 'Inline request' }),
    deleteThread: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue({ messages: [], earlierCursor: null }),
    openRun: emptyRun,
    ...overrides
  } satisfies AssistantTransport;
  return { apiBase: 'https://example.test/api', socket: { send: vi.fn(), subscribe: () => () => undefined } };
};

describe('AssistantWorkspace', () => {
  let rootElement: HTMLElement | null = null;
  let handle: AssistantWorkspaceMountHandle | null = null;
  let slotElements: HTMLElement[] = [];

  const element = () => {
    const next = document.createElement('div');
    document.body.appendChild(next);
    slotElements.push(next);
    return next;
  };

  const mountWorkspace = (props: AssistantWorkspaceProps) => {
    rootElement = document.createElement('div');
    document.body.appendChild(rootElement);
    act(() => {
      handle = mount(rootElement as HTMLElement, props);
    });
  };

  afterEach(() => {
    if (handle) {
      const current = handle;
      act(() => current.unmount());
    }
    handle = null;
    rootElement?.remove();
    rootElement = null;
    slotElements.forEach(slot => slot.remove());
    slotElements = [];
  });

  it('rejects a missing mount element', () => {
    expect(() =>
      mount(null as unknown as HTMLElement, {
        ...transport(),
        noteId: 'note-1',
        slots: []
      })
    ).toThrow('Mount element is required');
  });

  it('updates available height synchronously, ignores inner scrolling, and cleans up on close', () => {
    const navigation = element();
    const panel = element();
    let top = 110;
    const bounds = vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({ top, left: 40 }) as DOMRect);
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('110px');
    top = -190;
    fireEvent.scroll(window);
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('0px');
    top = 110;
    fireEvent.scroll(window);
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('110px');
    bounds.mockClear();
    fireEvent.scroll(within(panel).getByLabelText('Messages', { exact: true }));
    expect(bounds).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close AI Assistant' }));
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('');
  });

  it('reports panel visibility to the host and closes when the host asks', () => {
    const navigation = element();
    const panel = element();
    const visibility: boolean[] = [];
    let requestClose: (() => void) | undefined;
    const unsubscribe = vi.fn();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ],
      onPanelVisibilityChange: visible => visibility.push(visible),
      subscribePanelClose: listener => {
        requestClose = listener;
        return unsubscribe;
      }
    });
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    expect(visibility).toEqual([false]);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(visibility.at(-1)).toBe(true);

    act(() => requestClose?.());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(visibility.at(-1)).toBe(false);

    fireEvent.click(toggle);
    const current = handle;
    act(() => current?.unmount());
    handle = null;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(visibility.at(-1)).toBe(false);
  });

  it('sends from the panel and aborts the running request when the note changes', async () => {
    const navigation = element();
    const panelSlot = element();
    let runSignal: AbortSignal | undefined;
    const createThread = vi.fn().mockResolvedValue({ id: 'thread-1', title: 'Explain this' });
    const openRun = vi.fn(async function* (_id: string, _body: unknown, signal: AbortSignal) {
      runSignal = signal;
      yield { type: 'run.started' } as AssistantEvent;
      await new Promise(() => undefined);
    });
    const props = {
      ...transport({ createThread, openRun }),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panelSlot, kind: 'panel' as const }
      ]
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    const input = await within(panelSlot).findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: 'Explain this' } });
    fireEvent.click(within(panelSlot).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(runSignal).toBeDefined());
    expect(createThread).toHaveBeenCalledWith({ noteId: 'note-1', title: 'Explain this' });
    expect(openRun).toHaveBeenCalledWith('thread-1', { prompt: 'Explain this' }, expect.any(AbortSignal));
    expect(runSignal!.aborted).toBe(false);

    act(() => handle!.update({ ...props, noteId: 'note-2' }));

    expect(runSignal!.aborted).toBe(true);
  });

  it('resets workspace state on note change and removes every portal on unmount', async () => {
    const navigation = element();
    const panelSlot = element();
    const props = {
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panelSlot, kind: 'panel' as const }
      ]
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    expect(await within(document.body).findByRole('complementary', { name: 'AI Assistant workspace' })).toBeTruthy();

    act(() =>
      handle!.update({
        ...props,
        noteId: 'note-2'
      })
    );
    await waitFor(() =>
      expect(within(document.body).queryByRole('complementary', { name: 'AI Assistant workspace' })).toBeNull()
    );

    const current = handle!;
    handle = null;
    act(() => current.unmount());
    expect(navigation.childElementCount).toBe(0);
    expect(panelSlot.childElementCount).toBe(0);
  });
});
