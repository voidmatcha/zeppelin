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

import '../src/health.css';

export const globalTypes = {
  theme: {
    description: 'Theme',
    toolbar: { title: 'Theme', icon: 'circlehollow', items: ['light', 'dark'], dynamicTitle: true }
  }
};
export const initialGlobals = { theme: 'light' };

export const decorators = [
  (story, ctx) => {
    document.documentElement.dataset.theme = ctx.globals.theme;
    return story();
  }
];

export const parameters = { layout: 'padded', controls: { expanded: true } };

// Chip tooltip (WAI-ARIA tooltip pattern, WCAG 1.4.13): opens on hover after 150 ms or on focus, closes 100 ms after the
// pointer leaves, on blur or on Escape, and can be hovered. It is placed once when it opens (flipped and shifted to stay
// in the viewport) and then only follows the chip on scroll and resize.
import { arrow, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

const SHOW_DELAY = 150,
  HIDE_DELAY = 100;
let current = null; // { chip, tip, stop }
let showTimer = 0,
  hideTimer = 0;

const place = (chip, tip) => {
  const arrowEl = tip.querySelector('.tip-arrow');
  return computePosition(chip, tip, {
    strategy: 'fixed',
    placement: 'top-end',
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['bottom-end', 'top-start', 'bottom-start'] }),
      shift({ padding: 8 }),
      arrow({ element: arrowEl, padding: 6 })
    ]
  }).then(({ x, y, placement, middlewareData }) => {
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    const side = placement.split('-')[0];
    const a = middlewareData.arrow || {};
    Object.assign(arrowEl.style, {
      left: a.x != null ? `${a.x}px` : '',
      top: a.y != null ? `${a.y}px` : '',
      right: '',
      bottom: '',
      [side === 'top' ? 'bottom' : 'top']: '-4px',
      [side === 'top' ? 'top' : 'bottom']: ''
    });
  });
};

const open = chip => {
  clearTimeout(hideTimer);
  const tip = chip.querySelector(':scope > .tip');
  if (!tip || (current && current.chip === chip)) return;
  close();
  tip.style.display = 'block';
  current = { chip, tip, stop: autoUpdate(chip, tip, () => place(chip, tip)) };
};
const close = () => {
  clearTimeout(showTimer);
  if (!current) return;
  current.stop();
  current.tip.style.display = 'none';
  current = null;
};
const chipOf = e => e.target.closest?.('.zx-ih');

if (!window.__zxTips) {
  window.__zxTips = true;
  document.addEventListener('mouseover', e => {
    const chip = chipOf(e);
    if (!chip || chip.contains(e.relatedTarget)) return; // moving inside the chip or onto its tooltip: nothing changes
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => open(chip), SHOW_DELAY);
  });
  document.addEventListener('mouseout', e => {
    const chip = chipOf(e);
    if (!chip || chip.contains(e.relatedTarget)) return;
    clearTimeout(showTimer);
    hideTimer = setTimeout(close, HIDE_DELAY);
  });
  document.addEventListener('focusin', e => {
    const chip = chipOf(e);
    if (chip) open(chip);
  });
  document.addEventListener('focusout', e => {
    if (chipOf(e)) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });
}
