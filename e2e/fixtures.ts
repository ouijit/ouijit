import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
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
 * Launches the Electron app with isolated test directories.
 * Each call gets its own userData and scan dirs.
 */
async function launchApp(scanDirs: string[]): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-userdata-'));

  // Resolve the electron binary
  const electronBin = require.resolve('electron/index.js');
  const mainScript = path.resolve(__dirname, '..', '.vite', 'build', 'main.js');

  const electronApp = await _electron.launch({
    args: [mainScript],
    env: {
      ...process.env,
      OUIJIT_TEST_USER_DATA: userDataDir,
      OUIJIT_TEST_SCAN_DIRS: scanDirs.join(':'),
      // Disable DevTools in test mode
      NODE_ENV: 'test',
    },
  });

  // Get the first window
  const page = await electronApp.firstWindow();

  // Wait for the app to be ready (renderer loaded)
  await page.waitForLoadState('domcontentloaded');

  return { electronApp, page };
}

/**
 * Cleans up an Electron app instance and any orphaned processes.
 */
async function cleanupApp(electronApp: ElectronApplication, userDataDir?: string): Promise<void> {
  try {
    await electronApp.close();
  } catch {
    // App may already be closed
  }

  if (userDataDir) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

// Extend Playwright test with Ouijit-specific fixtures
type OuijitFixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
  testRepo: { repoPath: string; cleanup: () => void };
};

export const test = base.extend<OuijitFixtures>({
  testRepo: async ({}, use) => {
    const repo = createTestRepo();
    await use(repo);
    repo.cleanup();
  },

  electronApp: async ({ testRepo }, use) => {
    const { electronApp } = await launchApp([path.dirname(testRepo.repoPath)]);
    await use(electronApp);
    await cleanupApp(electronApp);
  },

  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await use(page);
  },
});

export { expect } from '@playwright/test';
