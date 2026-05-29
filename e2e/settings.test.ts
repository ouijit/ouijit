import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Adds the test repo, enters project mode, and opens its Project Settings
 * panel — driven through the exposed stores to avoid sidebar/kanban flakiness.
 */
async function openProjectSettings(appPage: Page, repoPath: string): Promise<void> {
  await appPage.evaluate(async (rp: string) => {
    const w = window as unknown as {
      api: typeof window.api;
      __appStore: { getState: () => any };
      __projectStore: { getState: () => any };
    };
    await w.api.addProject(rp);
    const projects = await w.api.refreshProjects();
    w.__appStore.getState().setProjects(projects);
    const project = projects.find((p) => p.path === rp);
    w.__appStore.getState().navigateToProject(rp, project);
    w.__projectStore.getState().setActivePanel('settings');
  }, repoPath);

  await expect(appPage.getByRole('heading', { name: 'Project Settings' })).toBeVisible({ timeout: 10_000 });
}

test('settings: project→app cross-link navigates, and the ready-audio toggle persists', async ({
  appPage,
  testRepo,
}) => {
  await openProjectSettings(appPage, testRepo.repoPath);

  // The supporting text carries an inline link to App Settings.
  await appPage.getByRole('button', { name: 'App Settings' }).click();

  // We land on the global App Settings panel (home view, settings panel).
  await expect(appPage.getByRole('heading', { name: 'App Settings' })).toBeVisible({ timeout: 10_000 });
  const view = await appPage.evaluate(() => {
    const s = (window as unknown as { __appStore: { getState: () => any } }).__appStore.getState();
    return { activeView: s.activeView, homeActivePanel: s.homeActivePanel };
  });
  expect(view).toEqual({ activeView: 'home', homeActivePanel: 'settings' });

  // The ready-audio toggle defaults to on (no persisted value yet).
  const soundRow = appPage.locator('label', { hasText: 'Play a sound when a task is ready' });
  const soundSwitch = soundRow.getByRole('switch');
  await expect(soundSwitch).toHaveAttribute('aria-checked', 'true');

  // Turning it off persists disableReadyAudio = '1' through the IPC boundary.
  await soundSwitch.click();
  await expect(soundSwitch).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(() => appPage.evaluate(() => window.api.globalSettings.get('disableReadyAudio')))
    .toBe('1');

  // Turning it back on clears it.
  await soundSwitch.click();
  await expect(soundSwitch).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(() => appPage.evaluate(() => window.api.globalSettings.get('disableReadyAudio')))
    .toBe('0');
});
