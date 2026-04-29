/**
 * Captures the new T-339 surfaces as PNGs into e2e/results/screens/.
 * Not a regression test — pure visual verification.
 *
 * Run with: npx playwright test screenshots.test --config e2e/playwright.config.ts
 */
import { test, _electron, type ElectronApplication, type Page } from '@playwright/test';

test.setTimeout(30_000);
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const OUT_DIR = path.resolve(__dirname, 'results', 'screens');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function launch(opts: { e2eFlag?: boolean }): Promise<{ app: ElectronApplication; page: Page; cleanup: () => void }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-screens-'));
  const mainScript = path.resolve(__dirname, '..', '.vite', 'build', 'main.js');
  const env: Record<string, string> = {
    ...process.env,
    OUIJIT_TEST_USER_DATA: userDataDir,
  };
  if (opts.e2eFlag) env.OUIJIT_E2E = '1';
  else delete env.OUIJIT_E2E;

  const app = await _electron.launch({ args: [mainScript, '--no-sandbox'], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Give the renderer a beat to mount and pull initial state
  await page.waitForTimeout(800);
  return {
    app,
    page,
    cleanup: () => {
      app.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

test('capture: home empty state (no projects)', async () => {
  const { page, cleanup } = await launch({ e2eFlag: true });
  try {
    await shot(page, '01-home-empty-no-projects');
  } finally {
    cleanup();
  }
});

test('capture: welcome dialog (fresh user data, no E2E flag)', async () => {
  const { page, cleanup } = await launch({ e2eFlag: false });
  try {
    // Welcome fires from main on did-finish-load; wait for it.
    await page.waitForTimeout(1500);
    await shot(page, '02-welcome-dialog');
  } finally {
    cleanup();
  }
});

test('capture: global settings panel', async () => {
  const { page, cleanup } = await launch({ e2eFlag: true });
  try {
    await page.evaluate(() => {
      (window as unknown as { __appStore?: { getState(): { setHomeActivePanel(p: 'home' | 'settings'): void } } }).__appStore?.getState().setHomeActivePanel('settings');
    });
    await page.waitForTimeout(400);
    await shot(page, '03-global-settings');
  } finally {
    cleanup();
  }
});

test('capture: home empty state (with a project, no terminals)', async () => {
  const { page, cleanup } = await launch({ e2eFlag: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-screen-repo-'));
  try {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    await page.evaluate(async (rp: string) => {
      await window.api.addProject(rp);
      const projects = await window.api.refreshProjects();
      (window as unknown as { __appStore: { getState(): { setProjects(p: unknown[]): void } } }).__appStore
        .getState()
        .setProjects(projects);
    }, tmpDir);
    await page.waitForTimeout(400);
    await shot(page, '04-home-empty-with-project');
  } finally {
    cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('capture: kanban with empty todo column', async () => {
  const { page, cleanup } = await launch({ e2eFlag: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-screen-repo-'));
  try {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "t@t.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "t"', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
    execSync('git add . && git commit -m init', { cwd: tmpDir, stdio: 'ignore' });
    await page.evaluate(async (rp: string) => {
      await window.api.addProject(rp);
      const projects = await window.api.refreshProjects();
      const store = (window as unknown as { __appStore: { getState(): { setProjects(p: unknown[]): void; navigateToProject(p: string, project: unknown): void } } }).__appStore;
      store.getState().setProjects(projects);
      const proj = (projects as Array<{ path: string }>).find((p) => p.path === rp);
      if (proj) store.getState().navigateToProject(rp, proj);
    }, tmpDir);
    await page.waitForTimeout(800);
    await shot(page, '05-kanban-empty-todo');
  } finally {
    cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

