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

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const { entries } = JSON.parse(readFileSync(new URL('../storybook-static/index.json', import.meta.url), 'utf8'));
const stories = Object.values(entries).filter(entry => entry.type === 'story');
if (!stories.length) throw new Error('The Storybook build contains no stories');

for (const story of stories) {
  for (const theme of ['light', 'dark']) {
    test(`${story.id} (${theme})`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.addInitScript(() => {
        window.storybookResult = { finished: [], errors: [] };
        const timer = setInterval(() => {
          const channel = window.__STORYBOOK_PREVIEW__?.channel;
          if (!channel) return;
          clearInterval(timer);
          channel.on('storyFinished', result => window.storybookResult.finished.push(result));
          for (const event of [
            'storyErrored',
            'storyThrewException',
            'playFunctionThrewException',
            'unhandledErrorsWhilePlaying'
          ]) {
            channel.on(event, () => window.storybookResult.errors.push(event));
          }
        }, 1);
      });
      await page.goto(`/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=theme:${theme}`);
      await page.waitForFunction(id => window.storybookResult.finished.some(result => result.storyId === id), story.id);
      const result = await page.evaluate(() => window.storybookResult);
      expect(result.finished.find(item => item.storyId === story.id).status).toBe('success');
      expect(result.errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('#storybook-root')).not.toBeEmpty();
    });
  }
}

test('looping flow keeps the composer visible in a compact viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?path=/story/assistant-looping-flows--ask-in-the-panel');
  const preview = page.frameLocator('#storybook-preview-iframe');
  await expect(preview.locator('.flow')).toBeVisible();
  await expect(preview.locator('textarea[aria-label="Message"]')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#storybook-preview-iframe')).toHaveJSProperty('clientHeight', 680);
  const region = preview.locator('[role="region"]');
  const footer = preview.locator('footer');
  const footerTop = (await footer.boundingBox()).y;
  await region.evaluate(element => {
    for (let index = 0; index < 20; index++) {
      const message = document.createElement('p');
      message.textContent = `Conversation message ${index}`;
      element.append(message);
    }
  });
  await region.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await footer.boundingBox()).y).toBe(footerTop);
  await expect(preview.locator('textarea[aria-label="Message"]')).toBeInViewport({ ratio: 1 });
});

test('AI badges share their corners and show gradient motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const state of ['conversation', 'active', 'navigation']) {
    await page.goto(`/iframe.html?id=assistant-assistanticon--${state}&viewMode=story`);
    const style = await page.locator('.zaohb82').evaluate(icon => ({
      radius: getComputedStyle(icon).borderRadius,
      gradientRadius: getComputedStyle(icon, '::before').borderRadius,
      animation: getComputedStyle(icon, '::before').animationName
    }));
    expect(style.radius).toBe('4px');
    expect(style.gradientRadius).toBe('4px');
    expect(style.animation).not.toBe('none');
    if (state === 'conversation') {
      const position = () => page.locator('.zaohb82').evaluate(icon => getComputedStyle(icon, '::before').backgroundPosition);
      const first = await position();
      await page.waitForTimeout(400);
      expect(await position()).not.toBe(first);
    }
  }
});
