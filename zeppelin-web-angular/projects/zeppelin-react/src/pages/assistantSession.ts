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

interface SelectedThreadRecord {
  version: 1;
  noteId: string;
  threadId: string;
}

interface DraftRecord {
  version: 1;
  noteId: string;
  threadId: string | null;
  draft: string;
}

const STORAGE_PREFIX = 'zeppelin.ai-assistant.v1';
const MAX_RECORD_BYTES = 500 * 1024;

function selectedThreadKey(noteId: string): string {
  return `${STORAGE_PREFIX}.selected.${encodeURIComponent(noteId)}`;
}

function draftKey(noteId: string, threadId: string | null): string {
  return `${STORAGE_PREFIX}.draft.${encodeURIComponent(JSON.stringify([noteId, threadId]))}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function parseRecord(value: string | null): unknown {
  if (value === null || serializedSize(value) > MAX_RECORD_BYTES) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function serializedSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function readSelectedThread(noteId: string): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const record = parseRecord(storage.getItem(selectedThreadKey(noteId)));
    if (
      !isRecord(record) ||
      !hasOnlyKeys(record, new Set(['version', 'noteId', 'threadId'])) ||
      record.version !== 1 ||
      record.noteId !== noteId ||
      !isNonEmptyString(record.threadId)
    ) {
      return null;
    }
    return record.threadId;
  } catch {
    return null;
  }
}

export function writeSelectedThread(noteId: string, threadId: string | null): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    if (threadId === null) {
      storage.removeItem(selectedThreadKey(noteId));
      return;
    }
    if (!isNonEmptyString(noteId) || !isNonEmptyString(threadId)) {
      return;
    }
    const record: SelectedThreadRecord = { version: 1, noteId, threadId };
    const serialized = JSON.stringify(record);
    if (serializedSize(serialized) <= MAX_RECORD_BYTES) {
      storage.setItem(selectedThreadKey(noteId), serialized);
    }
  } catch {
    // Selection persistence must not interrupt the assistant UI.
  }
}

export function readDraft(noteId: string, threadId: string | null): string {
  const storage = getStorage();
  if (!storage || !isNonEmptyString(noteId) || (threadId !== null && !isNonEmptyString(threadId))) {
    return '';
  }
  try {
    const record = parseRecord(storage.getItem(draftKey(noteId, threadId)));
    if (
      !isRecord(record) ||
      !hasOnlyKeys(record, new Set(['version', 'noteId', 'threadId', 'draft'])) ||
      record.version !== 1 ||
      record.noteId !== noteId ||
      record.threadId !== threadId ||
      typeof record.draft !== 'string'
    ) {
      return '';
    }
    return record.draft;
  } catch {
    return '';
  }
}

export function writeDraft(noteId: string, threadId: string | null, draft: string): boolean {
  const storage = getStorage();
  if (
    !storage ||
    !isNonEmptyString(noteId) ||
    (threadId !== null && !isNonEmptyString(threadId)) ||
    typeof draft !== 'string'
  ) {
    return false;
  }
  try {
    const key = draftKey(noteId, threadId);
    if (draft.length === 0) {
      storage.removeItem(key);
      return true;
    }

    const record: DraftRecord = { version: 1, noteId, threadId, draft };
    const serialized = JSON.stringify(record);
    const normalized = parseRecord(serialized);
    if (
      !isRecord(normalized) ||
      normalized.version !== 1 ||
      normalized.noteId !== noteId ||
      normalized.threadId !== threadId ||
      typeof normalized.draft !== 'string'
    ) {
      return false;
    }
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}
