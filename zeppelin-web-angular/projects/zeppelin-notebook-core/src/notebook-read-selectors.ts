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

import type { NotebookCoreReadSnapshot, NotebookCoreSnapshot } from './host-remote-contract';

export const selectReadData = (snapshot: NotebookCoreSnapshot): NotebookCoreReadSnapshot | null =>
  snapshot.readState?.status === 'ready' ? snapshot.readState.data : null;

export const selectNote = (snapshot: NotebookCoreSnapshot): NotebookCoreReadSnapshot['note'] | null =>
  selectReadData(snapshot)?.note ?? null;

export const selectParagraphOrder = (snapshot: NotebookCoreSnapshot): readonly string[] | null =>
  selectReadData(snapshot)?.paragraphOrder ?? null;

export const selectParagraph = (
  snapshot: NotebookCoreSnapshot,
  paragraphId: string
): NotebookCoreReadSnapshot['paragraphsById'][string] | null =>
  selectReadData(snapshot)?.paragraphsById[paragraphId] ?? null;

export const selectSavedResults = (snapshot: NotebookCoreSnapshot, paragraphId: string): unknown =>
  selectParagraph(snapshot, paragraphId)?.results ?? null;

export const selectPersistedVisualization = (snapshot: NotebookCoreSnapshot, paragraphId: string): unknown => {
  const config = selectParagraph(snapshot, paragraphId)?.config;
  return config !== null && typeof config === 'object' ? ((config as Record<string, unknown>).results ?? null) : null;
};

/** Unknown or failed ACL reads do not imply any capability. The server remains authoritative. */
export const selectReadPermissions = (
  snapshot: NotebookCoreSnapshot
): Extract<NonNullable<NotebookCoreSnapshot['readState']>['acl'], { status: 'ready' }>['permissions'] | null => {
  const acl = snapshot.readState?.acl;
  return acl?.status === 'ready' ? acl.permissions : null;
};
