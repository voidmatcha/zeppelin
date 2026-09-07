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

export type NotebookParagraphStatus = 'UNKNOWN' | 'READY' | 'PENDING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'ABORT';

export type NotebookParagraphResult = Readonly<{
  type: string;
  data: string;
}>;

export type NotebookParagraphResultConfigs = Readonly<Record<string, Readonly<{ graph: unknown }>>>;

export type NotebookFormValue = string | readonly string[];

export type NotebookDynamicForm = Readonly<{
  defaultValue: NotebookFormValue;
  hidden: boolean;
  name: string;
  displayName?: string;
  type: string;
  argument?: string;
  options?: readonly Readonly<{ value: string; displayName?: string }>[];
}>;

export type NotebookDynamicForms = Readonly<Record<string, NotebookDynamicForm>>;

export type NotebookFormParams = Readonly<Record<string, NotebookFormValue>>;

export type NotebookParagraphSnapshot = Readonly<{
  id: string;
  text: string;
  status: NotebookParagraphStatus;
  isDirty: boolean;
  results?: readonly NotebookParagraphResult[];
  resultConfigs?: NotebookParagraphResultConfigs;
}>;

export type NotebookParagraphInput = Omit<NotebookParagraphSnapshot, 'isDirty'>;

export type NotebookCorePhase = 'idle' | 'loading' | 'ready' | 'error';

export type NotebookCoreSnapshot = Readonly<{
  version: number;
  noteId: string;
  revisionId: string | null;
  phase: NotebookCorePhase;
  title: string | null;
  noteForms: NotebookDynamicForms;
  noteParams: NotebookFormParams;
  paragraphs: readonly NotebookParagraphSnapshot[];
  error: string | null;
}>;

export type NotebookCoreUnsubscribe = () => void;

export type NotebookCoreSnapshotListener = () => void;

export type NotebookCoreCommand =
  | Readonly<{ type: 'run-paragraph'; paragraphId: string }>
  | Readonly<{ type: 'cancel-paragraph'; paragraphId: string }>
  | Readonly<{ type: 'commit-paragraph'; paragraphId: string }>
  | Readonly<{ type: 'patch-paragraph'; paragraphId: string; patch: string }>;

export type NotebookCoreCommandHandler = (command: NotebookCoreCommand) => boolean;

export type NotebookCorePort = Readonly<{
  getSnapshot: () => NotebookCoreSnapshot;
  subscribe: (listener: NotebookCoreSnapshotListener) => NotebookCoreUnsubscribe;
  dispatch: NotebookCoreCommandHandler;
}>;

export type NotebookCoreRemoteProps = Readonly<{
  core: NotebookCorePort;
  readOnly?: boolean;
  onParagraphTextChange?: (paragraphId: string, text: string) => void;
  onParagraphInsert?: (index: number) => void;
  onParagraphRemove?: (paragraphId: string) => void;
  onParagraphMove?: (paragraphId: string, index: number) => void;
  onNotebookTitleChange?: (title: string) => void;
  onNoteFormsChange?: (params: NotebookFormParams) => void;
}>;
