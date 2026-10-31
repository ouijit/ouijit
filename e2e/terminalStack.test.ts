import { test, expect, createTestRepo, enterProject, launchApp, openBoard } from './fixtures';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const front = (appPage: Page) => appPage.locator('.project-card--active').getAttribute('data-pty-id');
const order = (appPage: Page): Promise<string[]> =>
  appPage.evaluate(() => (window as any).__terminalStore.getState().order);
const display = (appPage: Page, ptyId: string) =>
  appPage.evaluate((id) => (window as any).__terminalStore.getState().displayStates[id], ptyId);

/** Keys pressed into a focused xterm, where the capture-phase handler has to get them first. */
async function pressInTerminal(appPage: Page, key: string): Promise<void> {
  const xterm = appPage.locator('.project-card--active .terminal-xterm-container');
  const box = await xterm.boundingBox();
  // A full-width panel collapses the terminal beside it to nothing.
  if (box && box.width > 20) await xterm.click();
  else await appPage.locator('.project-card--active .pane-ledge').click({ position: { x: 300, y: 10 } });
  await appPage.keyboard.press(`${modifier}+${key}`);
}

async function newShell(appPage: Page): Promise<string> {
  const before = (await order(appPage)).length;
  await appPage.keyboard.press(`${modifier}+i`);
  await expect.poll(async () => (await order(appPage)).length, { timeout: 10_000 }).toBe(before + 1);
  const [ptyId] = await order(appPage);
  await expect.poll(() => front(appPage), { timeout: 10_000 }).toBe(ptyId);
  return ptyId;
}

const projectOrder = (appPage: Page, projects: string[]): Promise<string[]> =>
  appPage.evaluate((projects) => {
    const s = (window as any).__terminalStore.getState();
    return s.order.map((id: string) => s.displayStates[id].projectPath).filter((p: string) => projects.includes(p));
  }, projects);

/** Opens a task's worktree in a new terminal from its card on the board. */
async function openFromBoard(appPage: Page, taskName: string): Promise<string> {
  const before = (await order(appPage)).length;
  await appPage.locator('.kanban-card', { hasText: taskName }).first().click({ button: 'right' });
  const menu = appPage.locator('.context-menu--visible');
  await menu.getByRole('button', { name: 'Open in', exact: true }).hover();
  await menu.getByRole('button', { name: 'Host terminal', exact: true }).click();
  await expect.poll(async () => (await order(appPage)).length, { timeout: 15_000 }).toBe(before + 1);
  const [ptyId] = await order(appPage);
  await expect.poll(() => front(appPage), { timeout: 10_000 }).toBe(ptyId);
  return ptyId;
}

test('the sidebar navigates: a board from its project row, a terminal from the board, ⌘1–9 within its task, across a reload and a relaunch', async ({
  appPage,
  electronApp,
  testRepo,
  userDataDir,
}) => {
  test.setTimeout(120_000);
  const other = createTestRepo('other-project');
  let relaunched: ElectronApplication | undefined;
  try {
    await appPage.evaluate(
      async (paths: string[]) => {
        for (const p of paths) await window.api.addProject(p);
        (window as any).__appStore.getState().setProjects(await window.api.refreshProjects());
        await window.api.task.create(paths[0], 'Ship it');
        await window.api.hooks.save(paths[0], { id: 'run', type: 'run', name: 'Run', command: 'echo RUNNER_UP' });
      },
      [testRepo.repoPath, other.repoPath],
    );

    // Two terminals on one task: its stack holds both, the newer in front, and ⌘1 reaches the other.
    await openBoard(appPage, testRepo.repoPath);
    await expect(appPage.getByRole('banner').getByText('Board', { exact: true })).toBeVisible();
    const t1 = await openFromBoard(appPage, 'Ship it');
    await appPage.keyboard.press(`${modifier}+t`);
    const t2 = await openFromBoard(appPage, 'Ship it');
    await expect(appPage.locator('.project-card')).toHaveCount(2);
    await pressInTerminal(appPage, '1');
    await expect.poll(() => front(appPage)).toBe(t1);

    // A shell is a stack of its own.
    const shell = await newShell(appPage);
    await expect(appPage.locator('.project-card')).toHaveCount(1);

    // ⌘D and ⌘P act on the terminal in front.
    await pressInTerminal(appPage, 'd');
    await expect.poll(async () => (await display(appPage, shell)).diffPanelOpen).toBe(true);
    await appPage.keyboard.press(`${modifier}+d`);
    await expect.poll(async () => (await display(appPage, shell)).diffPanelOpen).toBe(false);
    await pressInTerminal(appPage, 'p');
    await expect
      .poll(async () => (await display(appPage, shell)).panels.map((p: { kind: string }) => p.kind))
      .toEqual(['runner']);

    // From the board, a terminal's row on its card opens that terminal with its task's stack.
    await appPage.keyboard.press(`${modifier}+t`);
    await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });
    const rows = appPage.locator('.kanban-card', { hasText: 'Ship it' }).locator('div.flex-row', { hasText: '─' });
    await expect(rows).toHaveCount(2);
    await rows.nth(1).click();
    await expect(appPage.locator('.kanban-board')).toHaveCount(0);
    await expect(appPage.locator('.project-card')).toHaveCount(2);
    const shown = await front(appPage);
    expect([t1, t2]).toContain(shown);

    // A renderer reload keeps the order and lands on the same terminal.
    const beforeReload = await order(appPage);
    await appPage.reload();
    await appPage.waitForLoadState('domcontentloaded');
    await expect.poll(() => order(appPage), { timeout: 30_000 }).toEqual(beforeReload);
    await expect.poll(() => front(appPage), { timeout: 10_000 }).toBe(shown);

    // ⌘W closes the front terminal and the task's other one takes its place.
    await pressInTerminal(appPage, 'w');
    await expect.poll(() => front(appPage), { timeout: 10_000 }).toBe(shown === t1 ? t2 : t1);

    // Quitting ends the shells; resuming on the next launch brings them back in the same order.
    await openBoard(appPage, other.repoPath);
    await newShell(appPage);
    const projects = [testRepo.repoPath, other.repoPath];
    const beforeQuit = await projectOrder(appPage, projects);
    await appPage.waitForTimeout(1_000);
    await electronApp.close();

    relaunched = await launchApp(userDataDir);
    const page = await relaunched.firstWindow();
    await page.getByRole('button', { name: 'Resume', exact: true }).click({ timeout: 20_000 });
    await expect.poll(() => projectOrder(page, projects), { timeout: 30_000 }).toEqual(beforeQuit);
  } finally {
    await relaunched?.close().catch(() => {});
    other.cleanup();
  }
});

test('an agent hook moves statusSince when the status changes, and repeated thinking leaves it alone', async ({
  appPage,
  testRepo,
}) => {
  test.setTimeout(60_000);
  await enterProject(appPage, testRepo.repoPath);
  const ptyId = await newShell(appPage);
  const status = async () => {
    const d = await display(appPage, ptyId);
    return { status: d.status, statusSince: d.statusSince };
  };

  // The hook script reads these from the terminal's environment; the test posts as it would.
  const envFile = path.join(testRepo.repoPath, '.hook-env');
  await appPage.locator('.project-card--active .terminal-xterm-container').click();
  await appPage.keyboard.type(`printf '%s\\n' "$OUIJIT_API_URL" "$OUIJIT_API_TOKEN" > '${envFile}'\n`);
  await expect.poll(() => fs.existsSync(envFile) && fs.readFileSync(envFile, 'utf8').split('\n').length > 2).toBe(true);
  const [url, token] = fs.readFileSync(envFile, 'utf8').split('\n');
  await expect.poll(async () => (await status()).status, { timeout: 10_000 }).toBe('success');
  const success = await status();
  const hook = async (next: 'thinking' | 'ready') => {
    const res = await fetch(`${url}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ptyId, action: 'status', status: next }),
    });
    expect(res.ok).toBe(true);
  };

  await hook('thinking');
  await expect.poll(async () => (await status()).status).toBe('thinking');
  const thinking = await status();
  expect(thinking.statusSince).toBeGreaterThan(success.statusSince);

  await hook('thinking');
  await hook('thinking');
  await appPage.waitForTimeout(300);
  expect(await status()).toEqual(thinking);
});
