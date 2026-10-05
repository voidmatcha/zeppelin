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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readDraft, readSelectedThread, writeDraft, writeSelectedThread } from './assistantSession';

const NOTE_ID = 'note/one';
const THREAD_ID = 'thread/one';
const SELECTED_KEY = 'zeppelin.ai-assistant.v1.selected.note%2Fone';

function draftKey(noteId = NOTE_ID, threadId: string | null = THREAD_ID): string {
  return `zeppelin.ai-assistant.v1.draft.${encodeURIComponent(JSON.stringify([noteId, threadId]))}`;
}

describe('assistantSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round trips and clears the selected thread per note', () => {
    writeSelectedThread(NOTE_ID, THREAD_ID);

    expect(readSelectedThread(NOTE_ID)).toBe(THREAD_ID);
    expect(readSelectedThread('note-two')).toBeNull();

    writeSelectedThread(NOTE_ID, null);
    expect(sessionStorage.getItem(SELECTED_KEY)).toBeNull();
  });

  it('rejects malformed and wrong-version selected threads', () => {
    sessionStorage.setItem(SELECTED_KEY, '{');
    expect(readSelectedThread(NOTE_ID)).toBeNull();

    sessionStorage.setItem(SELECTED_KEY, JSON.stringify({ version: 2, noteId: NOTE_ID, threadId: THREAD_ID }));
    expect(readSelectedThread(NOTE_ID)).toBeNull();
  });

  it('isolates drafts by note, thread, and new-conversation scope', () => {
    expect(writeDraft(NOTE_ID, THREAD_ID, 'thread one draft')).toBe(true);
    expect(writeDraft(NOTE_ID, 'thread-two', 'thread two draft')).toBe(true);
    expect(writeDraft(NOTE_ID, null, 'new conversation draft')).toBe(true);
    expect(writeDraft('note-two', THREAD_ID, 'other note draft')).toBe(true);

    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('thread one draft');
    expect(readDraft(NOTE_ID, 'thread-two')).toBe('thread two draft');
    expect(readDraft(NOTE_ID, null)).toBe('new conversation draft');
    expect(readDraft('note-two', THREAD_ID)).toBe('other note draft');
  });

  it('does not collide when note and thread ids contain key separators', () => {
    expect(writeDraft('a.b', 'c', 'first')).toBe(true);
    expect(writeDraft('a', 'b.c', 'second')).toBe(true);

    expect(readDraft('a.b', 'c')).toBe('first');
    expect(readDraft('a', 'b.c')).toBe('second');
  });

  it('removes the stored draft when it is cleared', () => {
    expect(writeDraft(NOTE_ID, THREAD_ID, 'unfinished prompt')).toBe(true);

    expect(writeDraft(NOTE_ID, THREAD_ID, '')).toBe(true);

    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');
    expect(sessionStorage.getItem(draftKey())).toBeNull();
  });

  it.each([
    ['malformed JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, noteId: NOTE_ID, threadId: THREAD_ID, draft: 'text' })],
    ['wrong note', JSON.stringify({ version: 1, noteId: 'other-note', threadId: THREAD_ID, draft: 'text' })],
    ['wrong thread', JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: 'other-thread', draft: 'text' })],
    ['non-string draft', JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: THREAD_ID, draft: 1 })],
    ['unknown field', JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: THREAD_ID, draft: 'text', messages: [] })]
  ])('rejects a draft with %s', (_description, serialized) => {
    sessionStorage.setItem(draftKey(), serialized);

    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');
  });

  it('rejects oversized drafts on read and write', () => {
    const oversizedDraft = '한'.repeat(200_000);

    sessionStorage.setItem(
      draftKey(),
      JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: THREAD_ID, draft: oversizedDraft })
    );
    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');

    sessionStorage.clear();
    expect(writeDraft(NOTE_ID, THREAD_ID, oversizedDraft)).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('returns safe fallbacks when storage is denied or full', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied');
    });

    expect(readSelectedThread(NOTE_ID)).toBeNull();
    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');
    expect(writeDraft(NOTE_ID, THREAD_ID, 'text')).toBe(false);

    vi.restoreAllMocks();
    const unavailableStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
    } as unknown as Storage;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(unavailableStorage);

    expect(writeDraft(NOTE_ID, THREAD_ID, 'text')).toBe(false);
    expect(() => writeSelectedThread(NOTE_ID, THREAD_ID)).not.toThrow();
  });
});
