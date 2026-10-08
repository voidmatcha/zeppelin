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

export type NotebookCoreSnapshot = Readonly<{
  noteId: string;
  revisionId: string | null;
  /** Optional while earlier host/remote contract probes still publish identity only. */
  readState?: NotebookCoreReadState;
  /** Local editor text is independent of the last server-owned paragraph snapshot. */
  draftsById?: Readonly<Record<string, NotebookCoreParagraphDraft>>;
}>;

export type NotebookCoreParagraphDraft = Readonly<{ text: string; version: number }>;

export type NotebookCoreCommand =
  | Readonly<{ type: 'editParagraph'; paragraphId: string; text: string }>
  | Readonly<{ type: 'saveParagraph'; paragraphId: string }>
  | Readonly<{ type: 'runParagraph'; paragraphId: string }>
  | Readonly<{ type: 'cancelParagraph'; paragraphId: string }>
  | Readonly<{ type: 'insertParagraph'; index: number }>
  | Readonly<{ type: 'moveParagraph'; paragraphId: string; index: number }>
  | Readonly<{ type: 'removeParagraph'; paragraphId: string }>;

/** Opaque identity: only the exact intent returned by this store can acknowledge a save. */
export type NotebookCoreSaveIntent = Readonly<{
  noteId: string;
  paragraphId: string;
  text: string;
  version: number;
  token: symbol;
}>;

export type NotebookCoreRunIntent = NotebookCoreSaveIntent;

export type NotebookCoreCommandResult =
  | Readonly<{ accepted: false }>
  | Readonly<{ accepted: true; save?: NotebookCoreSaveIntent; run?: NotebookCoreRunIntent }>;

/** The host sends returned save intents; the server remains the authority for writes. */
export type NotebookCoreCommandPort = NotebookCorePort &
  Readonly<{ dispatch: (command: NotebookCoreCommand) => NotebookCoreCommandResult }>;

/** The wire note's paragraph collection is stored once, by ID, in the Core. */
export type NotebookCoreReadSnapshot = Readonly<{
  note: Readonly<{ id: string; name: string; path: string } & Record<string, unknown>>;
  paragraphOrder: readonly string[];
  paragraphsById: Readonly<
    Record<string, Readonly<{ id: string; text: string; status: string } & Record<string, unknown>>>
  >;
}>;

export type NotebookCoreAclState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{
      status: 'ready';
      permissions: Readonly<{
        readers: readonly string[];
        owners: readonly string[];
        writers: readonly string[];
        runners: readonly string[];
      }>;
    }>
  | Readonly<{ status: 'accessDenied' | 'failed' }>;

export type NotebookCoreReadState =
  | Readonly<{ status: 'initial'; acl: NotebookCoreAclState }>
  | Readonly<{ status: 'loading'; acl: NotebookCoreAclState }>
  | Readonly<{ status: 'ready'; data: NotebookCoreReadSnapshot; acl: NotebookCoreAclState }>
  | Readonly<{ status: 'notFound' | 'accessDenied' | 'failed'; acl: NotebookCoreAclState }>
  | Readonly<{ status: 'disposed'; acl: NotebookCoreAclState }>;

export type NotebookCoreUnsubscribe = () => void;

export type NotebookCoreSnapshotListener = () => void;

export type NotebookCorePort = Readonly<{
  getSnapshot: () => NotebookCoreSnapshot;
  subscribe: (listener: NotebookCoreSnapshotListener) => NotebookCoreUnsubscribe;
}>;

export type NotebookCoreRemoteProps = Readonly<{
  core: NotebookCorePort;
}>;
