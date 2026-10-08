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

import { test, expect } from '@playwright/test';
test('standalone conversation sends, stops, loads history and deletes', async ({ page }) => {
  await page.goto('/examples/conversation-light.html');
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.getByRole('button', { name: 'Beginning of conversation' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Explain this notebook');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('[data-role="user"]').last()).toContainText('Explain this notebook');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Delete Notebook summary', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('[data-role]')).toHaveCount(0);
});
test('conversation search and read-only selection', async ({ page }) => {
  await page.goto('/examples/conversation-light.html');
  await page.locator('header > button[title="Notebook summary"]').click();
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('read-only');
  await page.getByRole('button', { name: 'Another user’s conversation (read-only)', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
});
test('edit and execution are approved separately', async ({ page }) => {
  await page.goto('/examples/approval-light.html');
  await expect(page.getByRole('button', { name: 'Allow execution', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Allow edit', exact: true }).click();
  await expect(page.getByText('Edit applied', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow execution', exact: true }).click();
  await expect(page.getByText('Execution completed', { exact: true })).toBeVisible();
});
test('skipping an edit never offers execution', async ({ page }) => {
  await page.goto('/examples/approval-light.html');
  await page.getByRole('button', { name: 'Skip edit', exact: true }).click();
  await expect(page.getByText('Edit skipped', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow execution', exact: true })).toHaveCount(0);
});
test('looping notebook question runs through response and restarts', async ({ page }) => {
  await page.goto('/iframe.html?id=assistant-looping-flows--ask-in-the-panel&viewMode=story');
  await expect(page.locator('.flow-notebook')).toBeVisible();
  await expect(page.locator('.flow-top, .flow-titlebar')).toHaveCount(0);
  await expect(page.locator('.flow-panel footer')).toBeInViewport();
  const footerGap = await page.locator('.flow-panel').evaluate(panel =>
    Math.abs(panel.getBoundingClientRect().bottom - panel.querySelector('footer').getBoundingClientRect().bottom)
  );
  expect(footerGap).toBeLessThan(2);
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await expect(message).not.toHaveValue('', { timeout: 7000 });
  await expect(send).toBeEnabled();
  await expect(page.locator('[data-role="user"]').last()).toContainText('Mention each paragraph id', { timeout: 7000 });
  await expect(send).toBeDisabled();
  await expect(page.locator('[data-role="assistant"]').last()).toHaveAttribute('aria-busy', 'true', { timeout: 10000 });
  await expect(page.locator('[data-role="assistant"]').last().locator('.zaohb82')).toHaveClass(/zaohb83/);
  await expect(page.locator('[data-role="assistant"]').last().getByRole('button', { name: 'Copy answer' })).toHaveCount(0);
  await expect(page.locator('.flow-stream-cursor')).toBeVisible();
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('paragraph_175957', { timeout: 15000 });
  await expect(page.locator('[data-role="assistant"]').last()).not.toHaveAttribute('aria-busy', 'true', { timeout: 10000 });
  await expect(page.locator('[data-role="assistant"]').last().locator('.zaohb82')).not.toHaveClass(/zaohb83/);
  await expect(page.locator('[data-role="assistant"]').last().getByRole('button', { name: 'Copy answer' })).toBeVisible();
  await expect(page.locator('[data-paragraph="group"] .flow-code')).toContainText("sales.groupby('region')");
  await expect(page.locator('[data-role="user"]')).toHaveCount(0, { timeout: 8000 });
});
test('looping planned flow shows notebook diff before separate execution approval', async ({ page }) => {
  await page.goto('/iframe.html?id=assistant-looping-flows--planned-approve-edit-then-run&viewMode=story');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).not.toHaveValue('', { timeout: 7000 });
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.locator('.flow-approval').first()).not.toContainText('<br>', { timeout: 7000 });
  await expect(page.locator('.flow-diff')).toBeVisible({ timeout: 7000 });
  await expect(page.getByText('Edit applied', { exact: true })).toBeVisible({ timeout: 9000 });
  await expect(page.getByText('2 actions completed', { exact: true })).toBeVisible({ timeout: 12000 });
  await expect(page.locator('[data-paragraph="group"] .flow-output')).toContainText('South    470');
  await expect(page.locator('[data-role="assistant"][aria-busy="true"] .zaohb83')).toBeVisible();
});
test('looping earlier history loads older messages', async ({ page }) => {
  await page.goto('/iframe.html?id=assistant-looping-flows--earlier-history&viewMode=story');
  await expect(page.getByRole('button', { name: 'Beginning of conversation' })).toBeVisible({ timeout: 7000 });
  await expect(page.locator('[data-role="user"]')).toHaveCount(13);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(13);
});
test('looping list searches and selects another conversation', async ({ page }) => {
  await page.goto('/iframe.html?id=assistant-looping-flows--list-and-search&viewMode=story');
  await expect(page.locator('.flow-list input')).toHaveValue('sales', { timeout: 7000 });
  await expect(page.locator('header button[title="Notebook summary"] span.sgxmck2')).toHaveText('Sales analysis by region', { timeout: 7000 });
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await expect(page.locator('[data-role="user"]')).toContainText('Summarize the revenue by region.');
});
test('looping read-only selection disables the composer', async ({ page }) => {
  await page.goto('/iframe.html?id=assistant-looping-flows--read-only&viewMode=story');
  await expect(page.locator('.flow-list input')).toHaveValue('another user', { timeout: 7000 });
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled({ timeout: 7000 });
});
test('looping skip leaves proposed paragraph unchanged', async ({ page }) => {
  await page.goto('/iframe.html?id=assistant-looping-flows--planned-skip-edit&viewMode=story');
  await expect(page.locator('.flow-diff')).toBeVisible({ timeout: 7000 });
  await expect(page.getByText('Edit skipped', { exact: true })).toBeVisible({ timeout: 7000 });
  await expect(page.locator('[data-paragraph="group"] .flow-code')).toContainText("print(by_region)");
});
