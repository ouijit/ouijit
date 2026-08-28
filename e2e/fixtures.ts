import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Creates a temporary git repo for testing.
 * Returns the path and a cleanup function.
 */
export function createTestRepo(name = 'test-project'): { repoPath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-'));
  const repoPath = path.join(tmpDir, name);
  fs.mkdirSync(repoPath, { recursive: true });

  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Project\n');
  execSync('git add . && git commit -m "init"', { cwd: repoPath, stdio: 'ignore' });

  return {
    repoPath,
    cleanup: () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * Helper: add a project and enter project mode.
 * Hovers the sidebar trigger zone to reveal the auto-hiding sidebar,
 * then clicks the project icon to navigate into project mode.
 */
export async function enterProject(appPage: Page, repoPath: string): Promise<void> {
  // Add project and refresh the store so the sidebar item renders
  await appPage.evaluate(async (rp: string) => {
    await window.api.addProject(rp);
    const projects = await window.api.refreshProjects();
    (window as any).__appStore.getState().setProjects(projects);
  }, repoPath);

  // Hover the left edge to reveal the auto-hiding sidebar
  await appPage.mouse.move(2, 200);
  const sidebarItem = appPage.locator('[data-project-path]').first();
  await expect(sidebarItem).toBeVisible({ timeout: 10_000 });
  await sidebarItem.click();
  // First entry shows kanban board (no existing terminals)
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 10_000 });
}

// Extend Playwright test with Ouijit-specific fixtures
type OuijitFixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
  testRepo: { repoPath: string; cleanup: () => void };
  userDataDir: string;
};

export const test = base.extend<OuijitFixtures>({
  testRepo: async ({}, use) => {
    const repo = createTestRepo();
    await use(repo);
    repo.cleanup();
  },

  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-userdata-'));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },

  electronApp: async ({ userDataDir }, use) => {
    const mainScript = path.resolve(__dirname, '..', '.vite', 'build', 'main.js');

    const electronApp = await _electron.launch({
      args: [mainScript, '--no-sandbox'],
      env: {
        ...process.env,
        OUIJIT_TEST_USER_DATA: userDataDir,
        OUIJIT_E2E: '1',
      },
    });

    await use(electronApp);

    try {
      await electronApp.close();
    } catch {
      // App may already be closed
    }
  },

  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
