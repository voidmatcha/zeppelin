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
import type { AssistantRunEvent, AssistantTransport } from '@/entities/assistant';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantWorkspaceMountHandle, AssistantWorkspaceProps, mount } from './AssistantWorkspace';

const emptyRun = async function* (): AsyncIterable<AssistantRunEvent> {
  yield { type: 'run.completed' };
};

// The workspace builds its conversation transport from `apiBase`; tests swap in spies.
const transportState = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/entities/assistant', async importOriginal => ({
  ...(await importOriginal<typeof import('@/entities/assistant')>()),
  createAssistantTransport: () => transportState.current
}));

const transport = (
  overrides: Partial<AssistantTransport> = {}
): Pick<AssistantWorkspaceProps, 'apiBase' | 'socket'> => {
  transportState.current = {
    listConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue({ id: 'inline-conversation', title: 'Inline request' }),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue({ messages: [], earlierCursor: null }),
    openRun: emptyRun,
    ...overrides
  } satisfies AssistantTransport;
  return {
    apiBase: 'https://example.test/api',
    socket: { send: vi.fn(), subscribe: () => () => undefined, subscribeClose: () => () => undefined }
  };
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

  it('updates available height synchronously, ignores inner scrolling, and cleans up on close', async () => {
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
    // The panel itself loads on first open.
    fireEvent.scroll(await within(panel).findByLabelText('Messages', { exact: true }));
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

  it('closes on Escape back to its sidebar button, but leaves an open list to close first', () => {
    const navigation = element();
    const panel = element();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    fireEvent.click(toggle);
    const aside = within(panel).getByRole('complementary', { name: 'AI Assistant workspace' });

    const expanded = document.createElement('button');
    expanded.setAttribute('aria-expanded', 'true');
    aside.appendChild(expanded);
    fireEvent.keyDown(expanded, { key: 'Escape' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expanded.remove();

    fireEvent.keyDown(within(aside).getByRole('button', { name: 'Close AI Assistant' }), { key: 'Escape' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('stays open when the signed-in account arrives after the panel was opened', async () => {
    const navigation = element();
    const panel = element();
    const props = {
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panel, kind: 'panel' as const }
      ]
    };
    mountWorkspace(props);
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    fireEvent.click(toggle);
    await within(panel).findByRole('textbox', { name: 'Message' });

    act(() => handle?.update({ ...props, draftOwner: 'alice' }));
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(await within(panel).findByRole('textbox', { name: 'Message' })).toBeTruthy();
  });

  it('returns focus to its sidebar button when closed with its close button', () => {
    const navigation = element();
    const panel = element();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    fireEvent.click(toggle);
    const close = within(panel).getByRole('button', { name: 'Close AI Assistant' });
    close.focus();
    fireEvent.click(close);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('shares the sidebar width and resizes it within the sidebar range by drag or arrow keys', () => {
    const navigation = element();
    const panel = element();
    const onPanelWidthChange = vi.fn();
    const props = {
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panel, kind: 'panel' as const }
      ],
      panelWidth: 420,
      onPanelWidthChange
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    const resizer = within(panel).getByRole('separator', { name: 'Resize AI Assistant' });
    expect(panel.style.getPropertyValue('--assistant-panel-width')).toBe('420px');

    fireEvent.keyDown(resizer, { key: 'Home' });
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(280);
    expect(resizer.getAttribute('aria-valuetext')).toBe('280 pixels wide');
    fireEvent.keyDown(resizer, { key: 'End' });
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(800);
    fireEvent.keyDown(resizer, { key: 'Home' });
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(296);

    // A drag shows each width without re-rendering and reports only where it ends, clamped to the sidebar's range.
    fireEvent.pointerDown(resizer, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 300, pointerId: 1, buttons: 1 });
    expect(panel.style.getPropertyValue('--assistant-panel-width')).toBe('280px');
    fireEvent.pointerMove(resizer, { clientX: 560, pointerId: 1, buttons: 1 });
    expect(resizer.getAttribute('aria-valuenow')).toBe('356');
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(onPanelWidthChange).toHaveBeenCalledTimes(5);
    // It starts from the width the keys left, even before the host echoes it back.
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(356);

    // The host's width, shared with the notebook sidebar, wins once the drag is over.
    act(() => handle?.update({ ...props, panelWidth: 480 }));
    expect(panel.style.getPropertyValue('--assistant-panel-width')).toBe('480px');
  });

  it('sends from the panel and aborts the running request when the note changes', async () => {
    const navigation = element();
    const panelSlot = element();
    let runSignal: AbortSignal | undefined;
    const createConversation = vi.fn().mockResolvedValue({ id: 'conversation-1', title: 'Explain this' });
    const openRun = vi.fn(async function* (_id: string, _body: unknown, signal: AbortSignal) {
      runSignal = signal;
      yield { type: 'run.started' } as AssistantRunEvent;
      await new Promise(() => undefined);
    });
    const props = {
      ...transport({ createConversation, openRun }),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panelSlot, kind: 'panel' as const }
      ]
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    const input = await within(panelSlot).findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Explain this' } });
    fireEvent.click(within(panelSlot).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(runSignal).toBeDefined());
    expect(createConversation).toHaveBeenCalledWith({ title: 'Explain this' });
    expect(openRun).toHaveBeenCalledWith('conversation-1', { prompt: 'Explain this' }, expect.any(AbortSignal));
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
