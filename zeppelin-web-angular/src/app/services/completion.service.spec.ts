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

import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CompletionReceived, OP } from '@zeppelin/sdk';
import { MessageService } from './message.service';
import { CompletionService } from './completion.service';

describe('CompletionService', () => {
  const createService = () => {
    const responses = new Subject<CompletionReceived>();
    const closed = new Subject<CloseEvent>();
    const messageService = {
      receive: vi.fn((op: OP) => {
        expect(op).toBe(OP.COMPLETION_LIST);
        return responses.asObservable();
      }),
      closed: vi.fn(() => closed.asObservable()),
      completion: vi.fn()
    } as unknown as MessageService;

    return { closed, messageService, responses, service: new CompletionService(messageService) };
  };

  it('subscribes before sending and resolves only the matching paragraph response', async () => {
    const { messageService, responses, service } = createService();

    const completion = service.requestCompletion('paragraph-1', '%python\npri', 11);
    responses.next({ id: 'other', completions: [{ name: 'ignored', value: 'ignored', meta: '' }] });
    responses.next({ id: 'paragraph-1', completions: [{ name: 'print', value: 'print', meta: 'builtin' }] });

    await expect(completion).resolves.toEqual([{ name: 'print', value: 'print', meta: 'builtin' }]);
    expect(messageService.completion).toHaveBeenCalledWith('paragraph-1', '%python\npri', 11);
    service.ngOnDestroy();
  });

  it('serializes requests for the same paragraph', async () => {
    const { messageService, responses, service } = createService();

    const first = service.requestCompletion('paragraph-1', 'first', 5);
    const second = service.requestCompletion('paragraph-1', 'second', 6);

    expect(messageService.completion).toHaveBeenCalledTimes(1);
    expect(messageService.completion).toHaveBeenLastCalledWith('paragraph-1', 'first', 5);

    responses.next({ id: 'paragraph-1', completions: [{ name: 'first-result', value: 'first-result', meta: '' }] });
    await expect(first).resolves.toEqual([{ name: 'first-result', value: 'first-result', meta: '' }]);
    await vi.waitFor(() => expect(messageService.completion).toHaveBeenCalledTimes(2));
    expect(messageService.completion).toHaveBeenLastCalledWith('paragraph-1', 'second', 6);

    responses.next({ id: 'paragraph-1', completions: [{ name: 'second-result', value: 'second-result', meta: '' }] });
    await expect(second).resolves.toEqual([{ name: 'second-result', value: 'second-result', meta: '' }]);
    service.ngOnDestroy();
  });

  it('allows requests for different paragraphs to run concurrently', async () => {
    const { messageService, responses, service } = createService();

    const first = service.requestCompletion('paragraph-1', 'first', 5);
    const second = service.requestCompletion('paragraph-2', 'second', 6);

    expect(messageService.completion).toHaveBeenCalledTimes(2);
    responses.next({ id: 'paragraph-2', completions: [{ name: 'second-result', value: 'second-result', meta: '' }] });
    responses.next({ id: 'paragraph-1', completions: [{ name: 'first-result', value: 'first-result', meta: '' }] });

    await expect(first).resolves.toEqual([{ name: 'first-result', value: 'first-result', meta: '' }]);
    await expect(second).resolves.toEqual([{ name: 'second-result', value: 'second-result', meta: '' }]);
    service.ngOnDestroy();
  });

  it('drains a late timed-out response before sending the next paragraph request', async () => {
    vi.useFakeTimers();
    const { messageService, responses, service } = createService();

    try {
      const timedOut = service.requestCompletion('paragraph-1', 'first', 5);
      const next = service.requestCompletion('paragraph-1', 'second', 6);

      expect(messageService.completion).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30000);
      await expect(timedOut).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(messageService.completion).toHaveBeenCalledTimes(1);

      responses.next({ id: 'paragraph-1', completions: [{ name: 'late-old', value: 'late-old', meta: '' }] });
      await vi.waitFor(() => expect(messageService.completion).toHaveBeenCalledTimes(2));
      expect(messageService.completion).toHaveBeenLastCalledWith('paragraph-1', 'second', 6);

      responses.next({ id: 'paragraph-1', completions: [{ name: 'new-result', value: 'new-result', meta: '' }] });
      await expect(next).resolves.toEqual([{ name: 'new-result', value: 'new-result', meta: '' }]);
      await Promise.resolve();

      const afterCleanup = service.requestCompletion('paragraph-1', 'third', 5);
      expect(messageService.completion).toHaveBeenCalledTimes(3);
      responses.next({ id: 'paragraph-1', completions: [] });
      await expect(afterCleanup).resolves.toEqual([]);
    } finally {
      service.ngOnDestroy();
      vi.useRealTimers();
    }
  });

  it('cancels stale lanes on disconnect and accepts new requests after reconnect', async () => {
    const { closed, messageService, responses, service } = createService();
    const active = service.requestCompletion('paragraph-1', 'first', 5);
    const queued = service.requestCompletion('paragraph-1', 'second', 6);

    closed.next({} as CloseEvent);

    await expect(active).rejects.toBeTruthy();
    await expect(queued).rejects.toThrow('WebSocket disconnected');
    expect(messageService.completion).toHaveBeenCalledTimes(1);

    const afterReconnect = service.requestCompletion('paragraph-1', 'third', 5);
    expect(messageService.completion).toHaveBeenCalledTimes(2);
    responses.next({ id: 'paragraph-1', completions: [{ name: 'fresh', value: 'fresh', meta: '' }] });
    await expect(afterReconnect).resolves.toEqual([{ name: 'fresh', value: 'fresh', meta: '' }]);
    service.ngOnDestroy();
  });
});
