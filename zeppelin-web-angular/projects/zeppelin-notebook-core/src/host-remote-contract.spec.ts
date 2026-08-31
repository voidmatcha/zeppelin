// @vitest-environment node

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

import { describe, expect, it } from 'vitest';

import type {
  NotebookCorePort,
  NotebookCoreRemoteProps,
  NotebookCoreSnapshot,
  NotebookCoreSnapshotListener
} from './public-api';

const fakeCorePort = (initialSnapshot: NotebookCoreSnapshot) => {
  let snapshot = initialSnapshot;
  const listeners = new Set<NotebookCoreSnapshotListener>();
  const core: NotebookCorePort = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return {
    core,
    publish: (nextSnapshot: NotebookCoreSnapshot) => {
      snapshot = nextSnapshot;
      for (const listener of listeners) {
        listener();
      }
    }
  };
};

describe('notebook core host and remote contract', () => {
  it('lets host and remote share one read-only snapshot source through getSnapshot and subscribe', () => {
    const host = fakeCorePort({ noteId: '2A94M5J1Z', revisionId: null });
    const remoteProps: NotebookCoreRemoteProps = { core: host.core };
    const snapshots: unknown[] = [];

    expect(remoteProps.core).toBe(host.core);

    const unsubscribe = remoteProps.core.subscribe(() => snapshots.push(remoteProps.core.getSnapshot()));
    host.publish({ noteId: '2A94M5J1Z', revisionId: 'rev-1' });
    unsubscribe();
    host.publish({ noteId: '2A94M5J1Z', revisionId: 'rev-2' });

    expect(snapshots).toEqual([{ noteId: '2A94M5J1Z', revisionId: 'rev-1' }]);
    expect(remoteProps.core.getSnapshot()).toEqual({ noteId: '2A94M5J1Z', revisionId: 'rev-2' });
  });
});
