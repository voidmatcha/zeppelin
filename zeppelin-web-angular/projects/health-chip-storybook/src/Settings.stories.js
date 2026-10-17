/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { BINDINGS, LABELS_BADGE, settingsRight } from './settings.js';

const STATES = Object.keys(LABELS_BADGE);

export default {
  title: 'Health chip/Settings panel (interpreter binding)',
  parameters: {
    docs: {
      description: {
        component: 'Replica of the note Settings > Interpreter binding panel (ZEPPELIN-6578).'
      }
    }
  }
};

export const BadgeAtFarRight = {
  parameters: {
    docs: {
      description: {
        story:
          'The badge (a button) sits at the right end of each row; a click checks again. Text first and dot last, so the dots stand in one column. A failure says why next to the label ("Unhealthy | No answer"), a failed check says "Check failed" and keeps the last result, and with several processes the failure shows a count ("1 of 2"). The native title only carries the check time.'
      }
    }
  },
  render: () =>
    settingsRight([
      [BINDINGS[0], 'healthy'],
      [BINDINGS[1], 'unhealthy', 'silent'],
      [BINDINGS[2], 'unhealthy', 'gone'],
      [BINDINGS[3], 'unhealthy', 'timeout', '1 of 2'],
      [BINDINGS[4], 'not-running'],
      [BINDINGS[5], 'starting'],
      [BINDINGS[6], 'failed']
    ])
};
