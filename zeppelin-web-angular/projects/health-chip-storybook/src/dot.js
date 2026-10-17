/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The dot of a health state: one SVG on a 12 x 12 grid, sized by CSS, so that everything in it (rings, bars, strokes)
// scales with it by the same ratio. The same shapes as the Angular component of the PoC branch.
const SHAPES = {
  healthy: '<circle class="body" cx="6" cy="6" r="6"/>',
  unhealthy: '<circle class="body" cx="6" cy="6" r="6"/><rect class="mark" x="5" y="3" width="2" height="6" rx="1"/>',
  starting:
    '<circle class="ring" cx="6" cy="6" r="5.25" stroke-width="1.5"/><path class="half" d="M6 0.75A5.25 5.25 0 0 0 6 11.25Z"/>',
  'not-running': '<circle class="ring" cx="6" cy="6" r="5" stroke-width="2"/>',
  checking: '<path class="arc" d="M9.536 2.464A5 5 0 1 1 2.464 2.464" stroke-width="2"/>',
  failed:
    '<circle class="body" cx="6" cy="6" r="6"/><rect class="mark" x="5" y="2" width="2" height="5" rx="1"/><rect class="mark" x="5" y="8" width="2" height="2" rx="1"/>',
  unknown: '<circle class="dashed" cx="6" cy="6" r="5.25" stroke-width="1.5" stroke-dasharray="3.2 2.3"/>'
};

export const dot = state =>
  `<svg class="dot" viewBox="0 0 12 12" aria-hidden="true" focusable="false">${SHAPES[state] ?? ''}</svg>`;
