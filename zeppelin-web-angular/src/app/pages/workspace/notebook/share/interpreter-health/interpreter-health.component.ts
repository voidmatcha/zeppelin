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

import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';

import { NzBadgeStatusType } from 'ng-zorro-antd/badge';

import {
  describeInterpreterGroups,
  summarizeInterpreterHealth,
  InterpreterGroupDetail,
  InterpreterHealthState,
  InterpreterHealthSummary,
  InterpreterHealthVerdict
} from './interpreter-health';

// A tooltip cannot scroll, so a setting with a process for every user or note must not grow it past the screen.
const MAX_LISTED_GROUPS = 8;

@Component({
  selector: 'zeppelin-notebook-interpreter-health',
  templateUrl: './interpreter-health.component.html',
  styleUrls: ['./interpreter-health.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookInterpreterHealthComponent implements OnChanges {
  @Input() verdict?: InterpreterHealthVerdict;
  @Input() loading = false;

  summary?: InterpreterHealthSummary;
  listedGroups: InterpreterGroupDetail[] = [];
  hiddenGroupCount = 0;

  // The pulsing dot is for the check that is under way. A verdict stands still, also when it is
  // that the interpreter is starting.
  readonly status: Record<InterpreterHealthState, NzBadgeStatusType> = {
    healthy: 'success',
    unhealthy: 'error',
    starting: 'warning',
    'not-running': 'default'
  };

  ngOnChanges(changes: SimpleChanges): void {
    const { verdict } = changes;
    if (verdict) {
      const groups = this.verdict ? describeInterpreterGroups(this.verdict.health) : [];
      this.summary = this.verdict && summarizeInterpreterHealth(this.verdict.health);
      this.listedGroups = groups.slice(0, MAX_LISTED_GROUPS);
      this.hiddenGroupCount = groups.length - this.listedGroups.length;
    }
  }
}
