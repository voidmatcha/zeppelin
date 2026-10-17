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

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const { entries } = JSON.parse(readFileSync(new URL('../storybook-static/index.json', import.meta.url), 'utf8'));
const stories = Object.values(entries).filter(e => e.type === 'story');
if (!stories.length) throw new Error('The Storybook build contains no stories');

const STATES = ['healthy', 'unhealthy', 'starting', 'not-running', 'checking', 'unknown', 'failed'];
const storyUrl = (id, theme) => `/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=theme:${theme}`;

const open = async (page, id, theme) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(storyUrl(id, theme));
  await page.locator('#storybook-root > *').first().waitFor();
  return errors;
};

for (const story of stories) {
  for (const theme of ['light', 'dark']) {
    test(`renders ${story.id} (${theme})`, async ({ page }) => {
      const errors = await open(page, story.id, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(errors).toEqual([]);
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`every health state has its own visible dot (${theme})`, async ({ page }) => {
    await open(page, 'health-chip-chip--all-health-states', theme);
    const sig = await page.$$eval('.zx-ih', chips =>
      chips.map(c => {
        const svg = c.querySelector('.dot');
        const paints = [...svg.querySelectorAll('*')].map(e => {
          const s = getComputedStyle(e);
          return `${s.fill}|${s.stroke}`;
        });
        return {
          state: c.dataset.state,
          visible: paints.some(p => p !== 'none|none'),
          sig: svg.innerHTML + paints.join(',')
        };
      })
    );
    expect(sig.map(s => s.state)).toEqual(STATES);
    for (const s of sig) expect(s.visible, `${s.state} must show a dot`).toBe(true);
    expect(new Set(sig.map(s => s.sig)).size, 'dots must be distinguishable without colour alone').toBe(sig.length);
    // unknown is a dashed outline; not-running is a solid ring: the two differ by line style
    const by = Object.fromEntries(sig.map(s => [s.state, s.sig]));
    expect(by.unknown).toContain('stroke-dasharray');
    expect(by['not-running']).not.toContain('stroke-dasharray');
  });

  test(`chip stays inside its card in every width and keeps the footer row (${theme})`, async ({ page }) => {
    await open(page, 'health-chip-paragraph-bottom-right--widths', theme);
    const bad = await page.$$eval('.zp', cards =>
      cards.flatMap(card => {
        const r = card.getBoundingClientRect(),
          c = card.querySelector('.zx-ih').getBoundingClientRect(),
          f = card.querySelector('.zp-ft').getBoundingClientRect();
        const out = [];
        if (c.right > r.right || c.left < r.left || c.bottom > r.bottom || c.top < r.top) out.push('chip outside card');
        if (f.height < 30) out.push('footer row shorter than 30px');
        return out;
      })
    );
    expect(bad).toEqual([]);
  });

  test(`the dot of the chip is centered under the last icon of the control, in the corner (${theme})`, async ({
    page
  }) => {
    await open(page, 'health-chip-paragraph-bottom-right--default', theme);
    const centerX = async selector => {
      const box = await page.locator(selector).last().boundingBox();
      return box.x + box.width / 2;
    };
    const icon = await centerX('.zp-ctl .zp-ico');
    const dot = await centerX('.zx-ih .dot');
    expect(Math.abs(dot - icon), 'dot and last icon on one vertical line').toBeLessThanOrEqual(1);
    const [card, chip] = [await page.locator('.zp').boundingBox(), await page.locator('.zx-ih').boundingBox()];
    expect(card.y + card.height - (chip.y + chip.height), 'close to the bottom edge').toBeLessThanOrEqual(8);
  });

  test(`the chip writes every state but healthy and checking in words and always ends with the dot (${theme})`, async ({
    page
  }) => {
    await open(page, 'health-chip-paragraph-bottom-right--health-states', theme);
    const texts = await page.$$eval('.zx-ih', chips =>
      chips.map(c => ({
        state: c.dataset.state,
        text: c.querySelector('.zx-text')?.textContent ?? null,
        last: c.querySelector(':scope > .dot, :scope > .tip') ? c.lastElementChild.className : ''
      }))
    );
    expect(texts.map(t => t.state)).toEqual(STATES);
    expect(texts.find(t => t.state === 'unhealthy').text).toBe('Unhealthy | No answer');
    expect(texts.find(t => t.state === 'failed').text).toBe(
      'Check failed | No privilege to check the interpreter health (last: Healthy)'
    );
    expect(
      texts.filter(t => t.text === null).map(t => t.state),
      'healthy and checking are a dot alone'
    ).toEqual(['healthy', 'checking']);
    expect(texts.find(t => t.state === 'unknown').text).toBe('Not checked');
    // a dot alone sits in a square, so that its hover area is even on every side
    const squares = await page.$$eval('.zx-ih', chips =>
      chips
        .filter(c => !c.querySelector('.zx-text'))
        .map(c => {
          const r = c.getBoundingClientRect();
          return [r.width, r.height];
        })
    );
    for (const [w, h] of squares) expect(w).toBe(h);
    expect(await page.$$eval('.zx-ih', cs => cs.every(c => c.getAttribute('aria-label').includes(': ')))).toBe(true);
    expect(await page.locator('.zx-ih > .dot').count()).toBe(texts.length);
    const dotIsBeforeTip = await page.$$eval('.zx-ih', chips =>
      chips.every(c => {
        const kids = [...c.children].filter(k => !k.classList.contains('tip'));
        return kids[kids.length - 1].classList.contains('dot');
      })
    );
    expect(dotIsBeforeTip, 'the dot is the last thing of the chip').toBe(true);
  });

  test(`chip never overlaps the footer text or the output (${theme})`, async ({ page }) => {
    await open(page, 'health-chip-paragraph-bottom-right--widths', theme);
    const hits = await page.$$eval('.zp', cards =>
      cards.flatMap(card => {
        const c = card.querySelector('.zx-ih').getBoundingClientRect();
        const hit = r => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
        const text = card.querySelector('.footer'),
          range = document.createRange();
        const rects = [];
        if (text && text.firstChild) {
          range.selectNodeContents(text);
          rects.push(...range.getClientRects());
        }
        const res = card.querySelector('.zp-result');
        if (res) rects.push(res.getBoundingClientRect());
        return rects.filter(hit).length ? ['overlap'] : [];
      })
    );
    expect(hits).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) {
  test(`settings panel (badge at far right): no Check health button, badge is the last control and failures say why (${theme})`, async ({
    page
  }) => {
    const errors = await open(page, 'health-chip-settings-panel-interpreter-binding--badge-at-far-right', theme);
    expect(errors).toEqual([]);
    await expect(page.getByText('Check health', { exact: true })).toHaveCount(0);
    const rows = await page.$$eval('.sp-box', boxes =>
      boxes.map(b => {
        const row = b.getBoundingClientRect(),
          badge = b.querySelector('button.badge'),
          r = badge.getBoundingClientRect(),
          name = b.querySelector('.sp-btn.primary').getBoundingClientRect();
        const visible = badge.querySelector('.text').textContent.trim();
        return {
          state: badge.dataset.state,
          right: Math.round(row.right - r.right),
          after: r.left >= name.right,
          label: badge.getAttribute('aria-label'),
          height: Math.round(r.height),
          visible,
          title: badge.getAttribute('title') ?? '',
          tips: badge.querySelectorAll('.tip').length
        };
      })
    );
    for (const r of rows) {
      expect(r.right, 'badge sits at the row end').toBeLessThanOrEqual(1);
      expect(r.after, 'badge after the name').toBe(true);
      expect(r.label).toMatch(/Check again$/);
      expect(r.height, 'target height').toBeGreaterThanOrEqual(24);
    }
    for (const r of rows.filter(r => r.state === 'unhealthy')) {
      expect(r.visible, 'reason must be visible without hovering').toMatch(
        /^Unhealthy \| (No answer|Process gone|Timed out)( \(1 of 2\))?$/
      );
      expect(r.label).toMatch(/Unhealthy, (no answer|process gone|timed out)( \(1 of 2\))?\. Check again$/);
    }
    for (const r of rows) expect(r.tips, 'no custom tooltip').toBe(0);
    expect(await page.locator('.badge.btn > :last-child.dot').count(), 'the dot comes last in every row').toBe(
      rows.length
    );
    expect(rows.find(r => r.state === 'failed').visible).toBe(
      'Check failed | No privilege to check the interpreter health (last: Healthy)'
    );
    expect(rows.find(r => r.state === 'healthy').title).toBe('Checked at 10:04:48 AM');
    expect(rows.find(r => r.state === 'starting').title).toBe('Checked at 10:04:48 AM');
    expect(rows.find(r => r.state === 'not-running').visible).toBe('Not running | starts on use');
    expect(
      rows.some(r => /\(1 of 2\)/.test(r.visible)),
      'count of failing processes is shown'
    ).toBe(true);
    const dots = await page.$$eval('.badge .dot', ds => ds.map(d => d.innerHTML));
    expect(new Set(dots).size, 'one look per state').toBe(new Set(rows.map(r => r.state)).size);
  });
}

const rect = async loc => {
  const r = await loc.boundingBox();
  return r && [r.x, r.y, r.width, r.height].map(v => Math.round(v * 2) / 2);
};

for (const theme of ['light', 'dark']) {
  for (const viewport of [
    { width: 1000, height: 900 },
    { width: 390, height: 800 }
  ]) {
    test(`chip tooltip stays inside the viewport for every width and state (${theme}, ${viewport.width}px)`, async ({
      page
    }) => {
      await page.setViewportSize(viewport);
      const errors = await open(page, 'health-chip-paragraph-bottom-right--health-states', theme);
      const chips = page.locator('.zx-ih');
      const n = await chips.count();
      for (let i = 0; i < n; i++) {
        const chip = chips.nth(i);
        await chip.scrollIntoViewIfNeeded();
        const state = await chip.getAttribute('data-state');
        await chip.hover();
        const tip = chip.locator('.tip');
        if (state === 'checking') {
          await expect(tip).toHaveCount(0);
          continue;
        }
        await expect(tip).toBeVisible();
        await page.waitForTimeout(60);
        const r = await tip.boundingBox();
        expect(r.x, `${state} left edge`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width, `${state} right edge`).toBeLessThanOrEqual(viewport.width);
        expect(r.y, `${state} top edge`).toBeGreaterThanOrEqual(0);
        await expect(tip).toContainText(/Healthy|Unhealthy|Starting|Not running|Not checked/);
        await expect(tip).toContainText('Click to check again');
        await page.mouse.move(0, 0);
        await expect(tip).toBeHidden();
      }
      expect(errors).toEqual([]);
    });
  }

  test(`chip tooltip does not move or resize while the pointer moves over the chip (${theme})`, async ({ page }) => {
    const errors = await open(page, 'health-chip-paragraph-bottom-right--default', theme);
    const chip = page.locator('.zx-ih').first(),
      tip = chip.locator('.tip');
    const box = await chip.boundingBox();
    await page.mouse.move(box.x + 12, box.y + 12);
    await expect(tip).toBeVisible();
    await page.waitForTimeout(150);
    const first = await rect(tip);
    for (const [dx, dy] of [
      [box.width - 10, 12],
      [3, 1],
      [12, 12],
      [box.width - 4, box.height - 2]
    ]) {
      await page.mouse.move(box.x + dx, box.y + dy);
      await page.waitForTimeout(80);
      expect(await rect(tip), `tooltip after moving to ${dx},${dy}`).toEqual(first);
    }
    expect(errors).toEqual([]);
  });

  test(`chip tooltip is hoverable: the pointer can move from the chip onto it (${theme})`, async ({ page }) => {
    const errors = await open(page, 'health-chip-paragraph-bottom-right--default', theme);
    const chip = page.locator('.zx-ih').first(),
      tip = chip.locator('.tip');
    await chip.hover();
    await expect(tip).toBeVisible();
    await page.waitForTimeout(150);
    const t = await tip.boundingBox();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
    await page.waitForTimeout(400);
    await expect(tip, 'WCAG 1.4.13 hoverable').toBeVisible();
    await page.mouse.move(5, 5);
    await expect(tip).toBeHidden();
    expect(errors).toEqual([]);
  });

  test(`chip tooltip follows the chip when the page scrolls (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 420 });
    const errors = await open(page, 'health-chip-paragraph-bottom-right--all-statuses', theme);
    const chip = page.locator('.zx-ih').nth(3),
      tip = chip.locator('.tip');
    await chip.scrollIntoViewIfNeeded();
    await chip.focus();
    await expect(tip).toBeVisible();
    await page.waitForTimeout(150);
    const gap = async () => {
      const c = await chip.boundingBox(),
        t = await tip.boundingBox();
      return [Math.round(c.x + c.width - (t.x + t.width)), Math.round(c.y - (t.y + t.height))];
    };
    const before = await gap();
    await page.evaluate(() => window.scrollBy(0, 30));
    await page.waitForTimeout(250);
    expect(await gap(), 'tooltip keeps its place relative to the chip').toEqual(before);
    expect(errors).toEqual([]);
  });

  test(`chip tooltip follows the ARIA tooltip pattern: describedby, no focus, Escape (${theme})`, async ({ page }) => {
    const errors = await open(page, 'health-chip-paragraph-bottom-right--unhealthy', theme);
    const chip = page.locator('.zx-ih').first(),
      tip = chip.locator('.tip');
    const id = await chip.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    await expect(page.locator(`#${id}`)).toHaveAttribute('role', 'tooltip');
    expect(await tip.getAttribute('tabindex'), 'a tooltip never takes focus').toBeNull();
    expect(await tip.locator('a,button,input,[tabindex]').count(), 'no controls inside a tooltip').toBe(0);
    await chip.focus();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Process exists but does not answer');
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(chip, 'focus stays on the chip').toBeFocused();
    expect(errors).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) {
  test(`forced-colors: every dot stays visible without its colour (${theme})`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, 'health-chip-chip--all-health-states', theme);
    const painted = ds =>
      ds.map(d => {
        const canvas = getComputedStyle(document.body).backgroundColor;
        return [...d.querySelectorAll('*')].some(e => {
          const s = getComputedStyle(e);
          return (s.fill !== 'none' && s.fill !== canvas) || (s.stroke !== 'none' && s.stroke !== canvas);
        });
      });
    const dots = await page.$$eval('.zx-ih .dot', painted);
    for (const [i, ok] of dots.entries()) expect(ok, `${STATES[i]} dot needs a fill or a stroke`).toBe(true);
    await open(page, 'health-chip-settings-panel-interpreter-binding--badge-at-far-right', theme);
    const badges = await page.$$eval('.badge .dot', painted);
    for (const ok of badges) expect(ok, 'badge dot needs a fill or a stroke').toBe(true);
  });

  test(`settings proposal does not overflow a 390px screen (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page, 'health-chip-settings-panel-interpreter-binding--badge-at-far-right', theme);
    const w = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    }));
    expect(w.scroll).toBeLessThanOrEqual(w.client);
  });

  test(`text contrast of the failure reason is at least 4.5:1 (${theme})`, async ({ page }) => {
    await open(page, 'health-chip-settings-panel-interpreter-binding--badge-at-far-right', theme);
    const ratio = await page.evaluate(() => {
      const rgb = c => c.match(/[\d.]+/g).map(Number);
      const lum = ([r, g, b]) => {
        const f = v => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const why = document.querySelector('.badge .text'),
        list = document.querySelector('.sp-list');
      const fg = rgb(getComputedStyle(why).color),
        bg = rgb(getComputedStyle(list).backgroundColor);
      const a = fg[3] ?? 1,
        mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const [x, y] = [lum(mix), lum(bg)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

for (const theme of ['light', 'dark']) {
  test(`the marks inside a dot keep their proportions at any size of the dot (${theme})`, async ({ page }) => {
    await open(page, 'health-chip-chip--all-health-states', theme);
    const ratios = async () =>
      page.$$eval('.zx-ih[data-state="unhealthy"] .dot, .zx-ih[data-state="failed"] .dot', dots =>
        dots.map(d => {
          const box = d.getBoundingClientRect();
          return [...d.querySelectorAll('.mark')].map(m => {
            const r = m.getBoundingClientRect();
            return [
              (r.left - box.left) / box.width,
              (r.top - box.top) / box.height,
              r.width / box.width,
              r.height / box.height
            ].map(v => Math.round(v * 1000) / 1000);
          });
        })
      );
    const before = await ratios();
    await page.addStyleTag({ content: '.dot { width: 36px !important; height: 36px !important; }' });
    const after = await ratios();
    expect(after, 'the same ratios at 3 times the size').toEqual(before);
    // every mark is centered on the vertical axis of its dot
    for (const marks of after) for (const [left, , width] of marks) expect(left + width / 2).toBeCloseTo(0.5, 2);
  });
}
