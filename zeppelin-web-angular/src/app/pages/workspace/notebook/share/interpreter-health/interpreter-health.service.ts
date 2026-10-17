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

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { finalize, timeout } from 'rxjs/operators';

import { NzMessageService } from 'ng-zorro-antd/message';

import { InterpreterService } from '@zeppelin/services';

import { InterpreterHealthVerdict, interpreterHealthErrorMessage } from './interpreter-health';

/** What is known about the health of one interpreter setting. */
export interface InterpreterHealthEntry {
  verdict?: InterpreterHealthVerdict;
  /** A check the user asked for is under way; a background refresh does not set it. */
  loading: boolean;
  /** Why the last check the user asked for failed; the last answer is kept beside it. */
  error?: string;
}

export interface InterpreterHealthCheckOptions {
  /** A refresh nobody asked for (a paragraph was run): no spinner, silent on failure, skipped if checked a moment ago. */
  background?: boolean;
}

/** A background refresh is skipped when the setting was checked more recently than this. */
export const BACKGROUND_REFRESH_INTERVAL_MS = 3000;

/** After a failed attempt a background refresh waits this long, so a server without the endpoint is asked once. */
export const BACKGROUND_FAILURE_BACKOFF_MS = 30000;

/** The server gives up on a probe after 3 s; later than this the answer is lost. */
export const CHECK_TIMEOUT_MS = 8000;

/**
 * The verdicts by interpreter setting, shared by the chips and the binding panel. The requests live here, not in a
 * component, so that a redraw does not lose one.
 */
@Injectable({ providedIn: 'root' })
export class InterpreterHealthService {
  private readonly entries = new Map<string, BehaviorSubject<InterpreterHealthEntry>>();
  private readonly inFlight = new Set<string>();
  /** When a setting was last asked, and whether that failed. */
  private readonly lastAttempt = new Map<string, { at: number; failed: boolean }>();
  /** Settings whose request in flight answers to the user (asked for, or taken over by a click). */
  private readonly foreground = new Set<string>();

  constructor(
    private interpreterService: InterpreterService,
    private nzMessageService: NzMessageService
  ) {}

  /** The entry of a setting; always the same observable. */
  entry$(settingId: string): Observable<InterpreterHealthEntry> {
    return this.entryOf(settingId);
  }

  check(settingId: string, noteId: string, options: InterpreterHealthCheckOptions = {}): void {
    const entry = this.entryOf(settingId);
    const background = !!options.background;
    if (this.inFlight.has(settingId)) {
      if (!background && !this.foreground.has(settingId)) {
        // A click during a background refresh takes it over: it shows a check under way and reports a failure.
        this.foreground.add(settingId);
        entry.next({ verdict: entry.value.verdict, loading: true });
      }
      return;
    }
    const verdict = entry.value.verdict;
    const last = this.lastAttempt.get(settingId);
    if (
      background &&
      last &&
      Date.now() - last.at < (last.failed ? BACKGROUND_FAILURE_BACKOFF_MS : BACKGROUND_REFRESH_INTERVAL_MS)
    ) {
      return;
    }

    this.inFlight.add(settingId);
    if (!background) {
      this.foreground.add(settingId);
      // The last answer stays while the new one is awaited.
      entry.next({ verdict, loading: true });
    }
    this.interpreterService
      .checkInterpreterHealth(settingId, noteId)
      .pipe(
        timeout({ first: CHECK_TIMEOUT_MS }),
        finalize(() => {
          this.inFlight.delete(settingId);
          this.foreground.delete(settingId);
          if (entry.value.loading) {
            entry.next({ verdict: entry.value.verdict, loading: false });
          }
        })
      )
      .subscribe({
        next: health => {
          this.lastAttempt.set(settingId, { at: Date.now(), failed: false });
          entry.next({ verdict: { health, checkedAt: new Date() }, loading: false });
        },
        error: error => {
          this.lastAttempt.set(settingId, { at: Date.now(), failed: true });
          if (this.foreground.has(settingId)) {
            const message = interpreterHealthErrorMessage(error);
            this.nzMessageService.error(message);
            entry.next({ verdict: entry.value.verdict, loading: false, error: message });
          }
        }
      });
  }

  /** Forgets what is known of a setting, for example after a restart. */
  clear(settingId: string): void {
    this.lastAttempt.delete(settingId);
    this.entries.get(settingId)?.next({ loading: false });
  }

  private entryOf(settingId: string): BehaviorSubject<InterpreterHealthEntry> {
    let entry = this.entries.get(settingId);
    if (!entry) {
      entry = new BehaviorSubject<InterpreterHealthEntry>({ loading: false });
      this.entries.set(settingId, entry);
    }
    return entry;
  }
}
