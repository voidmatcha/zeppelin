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

import { HttpErrorResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InterpreterHealthCheck } from '@zeppelin/interfaces';
import { InterpreterService } from '@zeppelin/services';

import { NzMessageService } from 'ng-zorro-antd/message';

import {
  BACKGROUND_FAILURE_BACKOFF_MS,
  BACKGROUND_REFRESH_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  InterpreterHealthEntry,
  InterpreterHealthService
} from './interpreter-health.service';

const answer = (settingId: string, healthy = true): InterpreterHealthCheck => ({
  settingId,
  settingName: settingId,
  groups: [
    { groupId: `${settingId}-shared_process`, healthy, reason: healthy ? 'OK' : 'PROBE_TIMEOUT', probeTookMs: 5 }
  ]
});

describe('InterpreterHealthService', () => {
  let requests: Array<{ settingId: string; noteId: string; reply: Subject<InterpreterHealthCheck> }>;
  let toasts: string[];
  let service: InterpreterHealthService;
  const seen = (settingId: string): InterpreterHealthEntry[] => {
    const entries: InterpreterHealthEntry[] = [];
    service.entry$(settingId).subscribe(entry => entries.push(entry));
    return entries;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
    requests = [];
    toasts = [];
    const interpreterService = {
      checkInterpreterHealth: (settingId: string, noteId: string) => {
        const reply = new Subject<InterpreterHealthCheck>();
        requests.push({ settingId, noteId, reply });
        return reply.asObservable();
      }
    } as unknown as InterpreterService;
    const messages = { error: (text: string) => toasts.push(text) } as unknown as NzMessageService;
    service = new InterpreterHealthService(interpreterService, messages);
  });

  afterEach(() => vi.useRealTimers());

  it('starts with nothing known', () => {
    expect(seen('a')).toEqual([{ loading: false }]);
  });

  it('shows a check under way and then what it found', () => {
    const entries = seen('a');

    service.check('a', 'note-1');
    requests[0].reply.next(answer('a'));
    requests[0].reply.complete();

    expect(entries.map(entry => entry.loading)).toEqual([false, true, false]);
    expect(entries[2].verdict?.health.settingId).toBe('a');
    expect(entries[2].verdict?.checkedAt).toEqual(new Date('2026-10-17T10:00:00Z'));
    expect(requests[0]).toMatchObject({ settingId: 'a', noteId: 'note-1' });
  });

  it('shares what it found with everyone who shows the setting', () => {
    const chip = seen('a');
    const panel = seen('a');

    service.check('a', 'note-1');
    requests[0].reply.next(answer('a'));
    requests[0].reply.complete();

    expect(chip[chip.length - 1].verdict).toBeDefined();
    expect(panel[panel.length - 1]).toBe(chip[chip.length - 1]);
  });

  it('keeps the settings apart', () => {
    const b = seen('b');

    service.check('a', 'note-1');
    requests[0].reply.next(answer('a'));
    requests[0].reply.complete();

    expect(b).toEqual([{ loading: false }]);
  });

  it('asks the server once while a check is under way', () => {
    service.check('a', 'note-1');
    service.check('a', 'note-1');
    service.check('a', 'note-1', { background: true });

    expect(requests).toHaveLength(1);
  });

  it('says why a check failed', () => {
    const entries = seen('a');

    service.check('a', 'note-1');
    requests[0].reply.error(new HttpErrorResponse({ status: 403 }));

    expect(toasts).toEqual(['No privilege to check the interpreter health']);
    expect(entries[entries.length - 1]).toEqual({
      verdict: undefined,
      loading: false,
      error: 'No privilege to check the interpreter health'
    });
  });

  it('keeps the last answer when a later check fails, and says it failed', () => {
    const entries = seen('a');
    service.check('a', 'note-1');
    requests[0].reply.next(answer('a'));
    requests[0].reply.complete();

    service.check('a', 'note-1');
    expect(entries[entries.length - 1].verdict).toBeDefined();
    requests[1].reply.error(new HttpErrorResponse({ status: 500 }));

    const last = entries[entries.length - 1];
    expect(last.verdict?.health.settingId).toBe('a');
    expect(last.loading).toBe(false);
    expect(last.error).toBe('Failed to check the interpreter health');
  });

  it('forgets the failure once a check succeeds', () => {
    const entries = seen('a');
    service.check('a', 'note-1');
    requests[0].reply.error(new HttpErrorResponse({ status: 500 }));

    service.check('a', 'note-1');
    requests[1].reply.next(answer('a'));
    requests[1].reply.complete();

    expect(entries[entries.length - 1].error).toBeUndefined();
    expect(entries[entries.length - 1].verdict).toBeDefined();
  });

  it('gives up on a check that is never answered and can be asked again', () => {
    const entries = seen('a');

    service.check('a', 'note-1');
    vi.advanceTimersByTime(CHECK_TIMEOUT_MS);

    expect(toasts).toEqual(['The server did not answer in time']);
    expect(entries[entries.length - 1]).toEqual({
      verdict: undefined,
      loading: false,
      error: 'The server did not answer in time'
    });
    service.check('a', 'note-1');
    expect(requests).toHaveLength(2);
  });

  it('shows a click that arrives during a refresh in the background as a check under way, with no second request', () => {
    const entries = seen('a');
    service.check('a', 'note-1', { background: true });
    expect(entries[entries.length - 1].loading).toBe(false);

    service.check('a', 'note-1');

    expect(entries[entries.length - 1].loading).toBe(true);
    expect(requests).toHaveLength(1);
    requests[0].reply.next(answer('a'));
    requests[0].reply.complete();
    expect(entries[entries.length - 1].loading).toBe(false);
    expect(entries[entries.length - 1].verdict).toBeDefined();
  });

  it('reports a failure to the user who took over a refresh in the background', () => {
    const entries = seen('a');
    service.check('a', 'note-1', { background: true });
    service.check('a', 'note-1');

    requests[0].reply.error(new HttpErrorResponse({ status: 403 }));

    expect(toasts).toEqual(['No privilege to check the interpreter health']);
    expect(entries[entries.length - 1].error).toBe('No privilege to check the interpreter health');
  });

  describe('in the background', () => {
    const checkOnce = () => {
      service.check('a', 'note-1');
      requests[requests.length - 1].reply.next(answer('a'));
      requests[requests.length - 1].reply.complete();
    };

    it('shows no spinner and replaces the answer when the new one arrives', () => {
      checkOnce();
      vi.advanceTimersByTime(BACKGROUND_REFRESH_INTERVAL_MS);
      const entries = seen('a');

      service.check('a', 'note-1', { background: true });
      expect(entries[entries.length - 1].loading).toBe(false);
      expect(entries[entries.length - 1].verdict?.health.groups[0].healthy).toBe(true);
      requests[1].reply.next(answer('a', false));
      requests[1].reply.complete();

      expect(entries.every(entry => !entry.loading)).toBe(true);
      expect(entries[entries.length - 1].verdict?.health.groups[0].healthy).toBe(false);
    });

    it('is skipped when the setting was checked a moment ago, so a run of many paragraphs asks once', () => {
      checkOnce();

      service.check('a', 'note-1', { background: true });
      vi.advanceTimersByTime(BACKGROUND_REFRESH_INTERVAL_MS - 1);
      service.check('a', 'note-1', { background: true });

      expect(requests).toHaveLength(1);
    });

    it('asks again once the answer is old enough', () => {
      checkOnce();

      vi.advanceTimersByTime(BACKGROUND_REFRESH_INTERVAL_MS);
      service.check('a', 'note-1', { background: true });

      expect(requests).toHaveLength(2);
    });

    it('asks even when nothing is known yet, which is how a first run shows the state', () => {
      service.check('a', 'note-1', { background: true });

      expect(requests).toHaveLength(1);
    });

    it('says nothing when it fails and keeps the last answer', () => {
      checkOnce();
      vi.advanceTimersByTime(BACKGROUND_REFRESH_INTERVAL_MS);
      const entries = seen('a');

      service.check('a', 'note-1', { background: true });
      requests[1].reply.error(new HttpErrorResponse({ status: 500 }));

      expect(toasts).toEqual([]);
      expect(entries[entries.length - 1].verdict?.health.groups[0].healthy).toBe(true);
    });

    it('stays quiet when it is never answered', () => {
      const entries = seen('a');

      service.check('a', 'note-1', { background: true });
      vi.advanceTimersByTime(CHECK_TIMEOUT_MS);

      expect(toasts).toEqual([]);
      expect(entries[entries.length - 1]).toEqual({ loading: false });
    });

    it('waits much longer after a failure, so that a server without the endpoint is asked once, not for every run', () => {
      service.check('a', 'note-1', { background: true });
      requests[0].reply.error(new HttpErrorResponse({ status: 404 }));

      vi.advanceTimersByTime(BACKGROUND_REFRESH_INTERVAL_MS);
      service.check('a', 'note-1', { background: true });
      expect(requests).toHaveLength(1);

      vi.advanceTimersByTime(BACKGROUND_FAILURE_BACKOFF_MS - BACKGROUND_REFRESH_INTERVAL_MS);
      service.check('a', 'note-1', { background: true });
      expect(requests).toHaveLength(2);
    });

    it('does not hold a click back: the user is answered even in the back-off', () => {
      service.check('a', 'note-1', { background: true });
      requests[0].reply.error(new HttpErrorResponse({ status: 500 }));

      service.check('a', 'note-1');

      expect(requests).toHaveLength(2);
    });
  });

  it('forgets a setting after its interpreter was restarted', () => {
    const entries = seen('a');
    service.check('a', 'note-1');
    requests[0].reply.next(answer('a'));
    requests[0].reply.complete();

    service.clear('a');

    expect(entries[entries.length - 1]).toEqual({ loading: false });
  });

  it('asks again right after a restart, whatever was asked a moment before', () => {
    service.check('a', 'note-1');
    requests[0].reply.next(answer('a'));
    requests[0].reply.complete();

    service.clear('a');
    service.check('a', 'note-1', { background: true });

    expect(requests).toHaveLength(2);
  });
});
