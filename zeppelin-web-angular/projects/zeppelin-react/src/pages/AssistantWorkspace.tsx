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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { CloseOutlined } from '@ant-design/icons';
import { Button, theme } from 'antd';
import type { AssistantSocket, AssistantTransport } from '@zeppelin/sdk';
import { ReactErrorBoundary } from '@/components';
import { ZeppelinThemeProvider } from '@/theme';
import { AssistantPanel } from './AssistantPanel';
import { AssistantIcon } from './AssistantIcon';
import { createAssistantTransport, scopeTransport } from './assistantTransport';
import './AssistantWorkspace.css';

export interface AssistantWorkspaceSlot {
  element: HTMLElement;
  kind: 'navigation' | 'panel';
}

export interface AssistantWorkspaceProps {
  noteId: string;
  /** The host's REST base (`.../api`); the remote calls the conversation REST API itself. */
  apiBase: string;
  /** The host's notebook WebSocket, used to send messages and receive run events. */
  socket: AssistantSocket;
  draftOwner?: string;
  slots: AssistantWorkspaceSlot[];
  onAuthError?: (status: number, location: string | null) => void;
  onError?: (error: unknown) => void;
  // Keeps the host sidebar to one open view at a time.
  onPanelVisibilityChange?: (visible: boolean) => void;
  subscribePanelClose?: (listener: () => void) => () => void;
}

const AssistantWorkspaceSession = (props: AssistantWorkspaceProps & AssistantTransport) => {
  const {
    noteId,
    slots,
    listThreads,
    createThread,
    deleteThread,
    getMessages,
    openRun,
    onPanelVisibilityChange,
    subscribePanelClose
  } = props;
  const { token } = theme.useToken();
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  useEffect(() => {
    onPanelVisibilityChange?.(panelVisible);
  }, [onPanelVisibilityChange, panelVisible]);
  useEffect(() => () => onPanelVisibilityChange?.(false), [onPanelVisibilityChange]);
  useEffect(() => subscribePanelClose?.(() => setPanelVisible(false)), [subscribePanelClose]);

  const openPanel = () => {
    setPanelMounted(true);
    setPanelVisible(true);
  };

  const panelSlot = slots.find(slot => slot.kind === 'panel');
  const panelElement = panelSlot?.element;
  useLayoutEffect(() => {
    if (!panelElement || !panelVisible) return;
    const measure = () => {
      const bounds = panelElement.getBoundingClientRect();
      // Sticky positioning moves the panel; only its height follows the header leaving the viewport.
      const top = `${Math.max(0, bounds.top)}px`;
      if (panelElement.style.getPropertyValue('--assistant-panel-top') !== top) {
        panelElement.style.setProperty('--assistant-panel-top', top);
      }
    };
    const onScroll = (event: Event) => {
      // Message-list scrolling cannot change the notebook slot's geometry.
      if (event.target instanceof Node && panelElement.contains(event.target)) return;
      measure();
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(panelElement);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', measure);
      panelElement.style.removeProperty('--assistant-panel-top');
    };
  }, [panelElement, panelVisible]);

  const portals = slots
    .filter(slot => slot.kind === 'navigation')
    .map(slot =>
      createPortal(
        <Button
          className="assistant-workspace-navigation-button"
          type="text"
          aria-label="Toggle AI Assistant"
          title="Toggle AI Assistant"
          aria-pressed={panelVisible}
          onClick={() => {
            if (panelVisible) {
              setPanelVisible(false);
            } else {
              openPanel();
            }
          }}
        >
          <AssistantIcon />
        </Button>,
        slot.element,
        slot.kind
      )
    );

  return (
    <>
      {portals}
      {panelMounted && panelSlot
        ? createPortal(
            <>
              <div
                aria-hidden="true"
                className={`assistant-workspace-panel-spacer${
                  panelVisible ? '' : ' assistant-workspace-panel-spacer-hidden'
                }`}
              />
              <aside
                aria-label="AI Assistant workspace"
                aria-hidden={!panelVisible}
                className={`assistant-workspace-panel${panelVisible ? '' : ' assistant-workspace-panel-hidden'}`}
                style={
                  {
                    color: token.colorText,
                    background: token.colorBgContainer,
                    '--assistant-workspace-border': token.colorBorderSecondary
                  } as React.CSSProperties
                }
              >
                <div className="assistant-workspace-panel-heading">
                  <strong>AI Assistant</strong>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined aria-hidden="true" />}
                    aria-label="Close AI Assistant"
                    onClick={() => setPanelVisible(false)}
                  />
                </div>
                <div className="assistant-workspace-panel-content">
                  <AssistantPanel
                    draftOwner={props.draftOwner}
                    noteId={noteId}
                    listThreads={listThreads}
                    createThread={createThread}
                    deleteThread={deleteThread}
                    getMessages={getMessages}
                    openRun={openRun}
                  />
                </div>
              </aside>
            </>,
            panelSlot.element,
            'assistant-panel'
          )
        : null}
    </>
  );
};

export const AssistantWorkspace = (props: AssistantWorkspaceProps) => {
  const { apiBase, noteId, onAuthError, socket } = props;
  // The host rebuilds its callbacks often; read the latest ones without replacing the transport.
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const scoped = useMemo(
    () =>
      scopeTransport(
        createAssistantTransport(
          apiBase,
          noteId,
          {
            send: message => socketRef.current.send(message),
            subscribe: listener => socketRef.current.subscribe(listener)
          },
          (status, location) => onAuthErrorRef.current?.(status, location)
        ),
        noteId
      ),
    [apiBase, noteId]
  );
  // A replaced transport (note change, unmount) drops its late responses and aborts its runs.
  useEffect(() => {
    scoped.setActive(true);
    return () => scoped.setActive(false);
  }, [scoped]);
  return <AssistantWorkspaceSession key={noteId} {...props} {...scoped.transport} />;
};

export interface AssistantWorkspaceMountHandle {
  update: (props: AssistantWorkspaceProps) => void;
  unmount: () => void;
}

export const mount = (element: HTMLElement, initialProps: AssistantWorkspaceProps): AssistantWorkspaceMountHandle => {
  if (!element) {
    throw new Error('Mount element is required');
  }
  const root: Root = createRoot(element);
  const renderWith = (props: AssistantWorkspaceProps) => {
    root.render(
      <ReactErrorBoundary onError={props.onError}>
        <ZeppelinThemeProvider prefixCls="zeppelin-ai">
          <AssistantWorkspace {...props} />
        </ZeppelinThemeProvider>
      </ReactErrorBoundary>
    );
  };
  // Commit the first portal buttons in the host's mount turn so they paint with the shell; updates stay concurrent.
  flushSync(() => renderWith(initialProps));
  return { update: renderWith, unmount: () => root.unmount() };
};
