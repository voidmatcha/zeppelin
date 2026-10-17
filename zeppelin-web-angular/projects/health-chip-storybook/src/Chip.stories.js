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

import { chip, HEALTH, INTERPRETERS } from './card.js';

export default {
  title: 'Health chip/Chip',
  argTypes: {
    interpreter: { control: 'select', options: INTERPRETERS },
    health: { control: 'select', options: HEALTH }
  }
};

export const AllHealthStates = {
  parameters: {
    docs: {
      description: {
        story:
          'healthy / unhealthy / starting / not running / checking / not checked. Meaning is carried by the dot shape as well as colour: not checked = dashed outline, not running = solid ring.'
      }
    }
  },
  render: () =>
    `<div class="row">${HEALTH.map(h => `<div><div class="cap">${h}</div>${chip('python', h)}</div>`).join('')}</div>`
};
