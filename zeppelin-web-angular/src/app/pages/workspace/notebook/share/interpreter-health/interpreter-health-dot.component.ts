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

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { InterpreterHealthView } from './interpreter-health';

/**
 * The dot of a health state, shared by the chip and the badge: one SVG on a 12 x 12 grid sized by CSS, so that everything
 * in it scales by the same ratio. Meaning never rests on colour alone: healthy is filled, unhealthy has a bar, starting
 * is half filled, not running is a ring, checking is a spinning arc, not checked is dashed and failed has a "!".
 */
@Component({
  selector: 'zeppelin-notebook-interpreter-health-dot',
  templateUrl: './interpreter-health-dot.component.html',
  styleUrls: ['./interpreter-health-dot.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookInterpreterHealthDotComponent {
  @Input() state!: InterpreterHealthView['state'];
}
