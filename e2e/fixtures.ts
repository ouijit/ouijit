import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

/** Opens a registered project's board from its row in the sidebar. */
export async function openBoard(appPage: Page, repoPath: string): Promise<void> {
  await appPage.locator(`[data-project-path="${repoPath}"]`).getByRole('button', { name: 'Board' }).click();
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 10_000 });
}

/** Registers a project and opens its board. */
export async function enterProject(appPage: Page, repoPath: string): Promise<void> {
  await appPage.evaluate(async (rp: string) => {
    await window.api.addProject(rp);
    const projects = await window.api.refreshProjects();
    (window as any).__appStore.getState().setProjects(projects);
  }, repoPath);
  await openBoard(appPage, repoPath);
}

interface ApiCredentials {
  url: string;
  token: string;
}

async function apiCredentials(electronApp: ElectronApplication): Promise<ApiCredentials> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const api = await electronApp.evaluate(() => (globalThis as { __ouijitE2EApi?: ApiCredentials }).__ouijitE2EApi);
    if (api) return api;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The app never exposed its API credentials');
}

/**
 * Runs the built `ouijit` CLI against the app under test and returns its JSON.
 * `args` goes through a shell, so quote it the way you would at a prompt.
 */
export type Cli = <T = unknown>(args: string, options?: { project?: string }) => Promise<T>;

// Extend Playwright test with Ouijit-specific fixtures
type OuijitFixtures = {
  electronApp: ElectronApplication;
  cli: Cli;
  appPage: Page;
  testRepo: { repoPath: string; cleanup: () => void };
  userDataDir: string;
};

export function launchApp(userDataDir: string): Promise<ElectronApplication> {
  return _electron.launch({
    args: [path.resolve(__dirname, '..', '.vite-e2e', 'build', 'main.js'), '--no-sandbox'],
    env: { ...process.env, OUIJIT_TEST_USER_DATA: userDataDir, OUIJIT_E2E: '1' },
  });
}

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
    const electronApp = await launchApp(userDataDir);

    await use(electronApp);

    try {
      await electronApp.close();
    } catch {
      // App may already be closed
    }
  },

  cli: async ({ electronApp }, use) => {
    const cliPath = path.resolve(__dirname, '..', 'dist-cli', 'ouijit.js');
    let credentials: Promise<ApiCredentials> | undefined;

    await use(async (args, { project } = {}) => {
      const api = await (credentials ??= apiCredentials(electronApp));
      // The runner may itself be inside an Ouijit terminal, whose session would
      // otherwise answer the markdown and preview commands.
      const { OUIJIT_PTY_ID: _, ...env } = process.env;
      // --project rather than cwd detection: git resolves the tmpdir through
      // its symlink (/var → /private/var), which is not the path the app registered.
      const projectFlag = project ? '--project "$OUIJIT_E2E_PROJECT" ' : '';
      try {
        const { stdout } = await execFileAsync(
          '/bin/sh',
          ['-c', `"$OUIJIT_E2E_NODE" "$OUIJIT_E2E_CLI" ${projectFlag}${args}`],
          {
            cwd: os.tmpdir(),
            env: {
              ...env,
              OUIJIT_API_URL: api.url,
              OUIJIT_API_TOKEN: api.token,
              OUIJIT_E2E_NODE: process.execPath,
              OUIJIT_E2E_CLI: cliPath,
              OUIJIT_E2E_PROJECT: project ?? '',
            },
          },
        );
        return JSON.parse(stdout);
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr?.trim();
        throw new Error(`ouijit ${args}: ${stderr || (err as Error).message}`);
      }
    });
  },

  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
