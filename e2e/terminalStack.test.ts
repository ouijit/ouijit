import { test, expect, createTestRepo } from './fixtures';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const front = (appPage: Page) => appPage.locator('.project-card--active').getAttribute('data-pty-id');
/** What the sidebar's home button does, including remembering it for the next load. */
async function goHome(appPage: Page): Promise<void> {
  await appPage.evaluate(async () => {
    (window as any).__appStore.getState().navigateHome();
    await window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'home' }));
  });
}

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

test('one set of terminal shortcuts drives both views, and the stack survives a reload and a relaunch', async ({
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
        await window.api.hooks.save(paths[0], { id: 'run', type: 'run', name: 'Run', command: 'echo RUNNER_UP' });
        // The resume banner sits with the recent tasks, so there has to be one.
        await window.api.task.create(paths[0], 'Keep a recent task');
      },
      [testRepo.repoPath, other.repoPath],
    );

    // In a project: two shells, the newer in front; ⌘1 counts from the top of the back stack.
    await appPage.mouse.move(2, 200);
    await appPage.locator(`[data-project-path="${testRepo.repoPath}"]`).click();
    await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 10_000 });
    const a1 = await newShell(appPage);
    const a2 = await newShell(appPage);
    await pressInTerminal(appPage, '1');
    await expect.poll(() => front(appPage)).toBe(a1);

    // On home: a new shell comes to the front from inside a focused terminal,
    // and positions follow the grouped order, home's shells ahead of the project's.
    await goHome(appPage);
    await expect.poll(() => front(appPage), { timeout: 10_000 }).toBe(a1);
    await appPage.locator('.project-card--active .terminal-xterm-container').click();
    const h1 = await newShell(appPage);
    expect(await order(appPage)).toEqual([h1, a1, a2]);
    await pressInTerminal(appPage, '1');
    await expect.poll(() => front(appPage)).toBe(a2);
    expect((await order(appPage)).slice(0, 2)).toEqual([a2, h1]);

    // ⌘D and ⌘P act on home's front terminal, in its own project.
    await pressInTerminal(appPage, 'd');
    await expect.poll(async () => (await display(appPage, a2)).diffPanelOpen).toBe(true);
    await appPage.keyboard.press(`${modifier}+d`);
    await expect.poll(async () => (await display(appPage, a2)).diffPanelOpen).toBe(false);
    await pressInTerminal(appPage, 'p');
    await expect
      .poll(async () => (await display(appPage, a2)).panels.map((p: { kind: string }) => p.kind))
      .toEqual(['runner']);

    // ⌘T is home's own key: it regroups by tag.
    await appPage.keyboard.press(`${modifier}+t`);
    await expect(appPage.getByText('Untagged', { exact: true })).toBeVisible();
    await appPage.keyboard.press(`${modifier}+t`);

    // A renderer reload keeps the order and the front terminal.
    const beforeReload = await order(appPage);
    await appPage.reload();
    await appPage.waitForLoadState('domcontentloaded');
    await expect.poll(() => order(appPage), { timeout: 30_000 }).toEqual(beforeReload);
    await expect.poll(() => front(appPage), { timeout: 10_000 }).toBe(a2);

    // ⌘W closes the front terminal and the one used before it takes its place.
    await pressInTerminal(appPage, 'w');
    await expect.poll(() => front(appPage), { timeout: 10_000 }).toBe(h1);

    // Quitting ends the shells; resuming on the next launch brings the
    // project ones back in the same order.
    await appPage.mouse.move(2, 200);
    await appPage.locator(`[data-project-path="${other.repoPath}"]`).click();
    await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 10_000 });
    await newShell(appPage);
    await goHome(appPage);
    // The deepest card is ⌘1: Alpha's, behind the Bravo and home groups.
    await pressInTerminal(appPage, '1');
    await expect.poll(() => front(appPage)).toBe(a1);
    const projects = [testRepo.repoPath, other.repoPath];
    const beforeQuit = await projectOrder(appPage, projects);
    expect(beforeQuit).toEqual([testRepo.repoPath, other.repoPath]);
    await appPage.waitForTimeout(1_000);
    await electronApp.close();

    relaunched = await _electron.launch({
      args: [path.resolve(__dirname, '..', '.vite', 'build', 'main.js'), '--no-sandbox'],
      env: { ...process.env, OUIJIT_TEST_USER_DATA: userDataDir, OUIJIT_E2E: '1' },
    });
    const page = await relaunched.firstWindow();
    await page.getByRole('button', { name: 'Resume', exact: true }).click({ timeout: 20_000 });
    await expect.poll(() => projectOrder(page, projects), { timeout: 30_000 }).toEqual(beforeQuit);
  } finally {
    await relaunched?.close().catch(() => {});
    other.cleanup();
  }
});
