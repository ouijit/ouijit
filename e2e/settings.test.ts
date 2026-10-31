import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/** Adds the test repo and opens its settings from its row's menu in the sidebar. */
async function openProjectSettings(appPage: Page, repoPath: string): Promise<void> {
  await appPage.evaluate(async (rp: string) => {
    await window.api.addProject(rp);
    const projects = await window.api.refreshProjects();
    (window as unknown as { __appStore: { getState: () => any } }).__appStore.getState().setProjects(projects);
  }, repoPath);
  await appPage
    .locator(`[data-project-path="${repoPath}"]`)
    .getByRole('button', { name: /^More for / })
    .click();
  await appPage.locator('.context-menu--visible').getByRole('button', { name: 'Settings' }).click();
  await expect(appPage.getByRole('heading', { name: 'Project Settings' })).toBeVisible({ timeout: 10_000 });
}

test('settings: project→app cross-link navigates, and the ready-audio toggle persists', async ({
  appPage,
  testRepo,
}) => {
  await openProjectSettings(appPage, testRepo.repoPath);

  // The supporting text carries an inline link to App Settings.
  await appPage.getByRole('button', { name: 'App Settings' }).click();

  await expect(appPage.getByRole('heading', { name: 'App Settings' })).toBeVisible({ timeout: 10_000 });
  const selection = await appPage.evaluate(
    () => (window as unknown as { __appStore: { getState: () => any } }).__appStore.getState().selection,
  );
  expect(selection).toEqual({ kind: 'app-settings' });

  // The ready-audio toggle defaults to on (no persisted value yet).
  const soundRow = appPage.locator('label', { hasText: 'Play a sound when a task is ready' });
  const soundSwitch = soundRow.getByRole('switch');
  await expect(soundSwitch).toHaveAttribute('aria-checked', 'true');

  // Turning it off persists disableReadyAudio = '1' through the IPC boundary.
  await soundSwitch.click();
  await expect(soundSwitch).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => appPage.evaluate(() => window.api.globalSettings.get('disableReadyAudio'))).toBe('1');

  // Turning it back on clears it.
  await soundSwitch.click();
  await expect(soundSwitch).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => appPage.evaluate(() => window.api.globalSettings.get('disableReadyAudio'))).toBe('0');
});
