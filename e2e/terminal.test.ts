import { test, expect, enterProject, type Cli } from './fixtures';
import type { Page } from '@playwright/test';
import * as path from 'node:path';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const selection = (appPage: Page) => appPage.evaluate(() => (window as any).__appStore.getState().selection);

/**
 * The pixel centre of `text`'s first cell in the front terminal. xterm draws
 * links itself, so there is no element to click: the cell comes from the
 * screen's size divided into its rows, and the width xterm measured for one
 * character.
 */
async function cellOf(appPage: Page, text: string): Promise<{ x: number; y: number } | null> {
  return appPage.evaluate((text) => {
    const xterm = document.querySelector('.project-card--active .xterm');
    if (!xterm) return null;
    const screen = xterm.querySelector('.xterm-screen')!.getBoundingClientRect();
    const rows = Array.from(xterm.querySelectorAll('.xterm-rows > div'));
    const measure = xterm.querySelector('.xterm-char-measure-element')!;
    const cellWidth = measure.getBoundingClientRect().width / measure.textContent!.length;
    const cols = Math.round(screen.width / cellWidth);
    const cellHeight = screen.height / rows.length;
    // The output line, not the command line that echoed it: that one starts with the prompt.
    const row = rows.findIndex((r) => r.textContent!.startsWith(text));
    if (row < 0) return null;
    const col = Math.min(4, cols - 1);
    return {
      x: screen.left + (col + 0.5) * (screen.width / cols),
      y: screen.top + (row + 0.5) * cellHeight,
    };
  }, text);
}

test('clicking an ouijit:// link printed in a terminal opens what it names', async ({ appPage, testRepo }) => {
  test.setTimeout(30_000);
  await enterProject(appPage, testRepo.repoPath);
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-card--active .xterm')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await selection(appPage)).kind, { timeout: 10_000 }).toBe('terminal');

  const link = `ouijit://${path.basename(testRepo.repoPath)}/board`;
  // The quotes keep the link out of the typed command line, so only the output matches.
  await appPage.keyboard.type(`echo ouijit:/""/${path.basename(testRepo.repoPath)}/board`);
  await appPage.keyboard.press('Enter');

  let cell: { x: number; y: number } | null = null;
  await expect.poll(async () => (cell = await cellOf(appPage, link)), { timeout: 10_000 }).not.toBeNull();
  await appPage.mouse.move(cell!.x, cell!.y);
  await expect(appPage.locator('.project-card--active .xterm-cursor-pointer')).toHaveCount(1, { timeout: 5_000 });
  await appPage.mouse.click(cell!.x, cell!.y);

  await expect
    .poll(() => selection(appPage), { timeout: 5_000 })
    .toEqual({
      kind: 'page',
      projectPath: testRepo.repoPath,
      page: 'board',
    });
  await expect(appPage.locator('.kanban-board')).toBeVisible();
});

const taskTerminals = async (cli: Cli, repoPath: string, taskNumber: number): Promise<string[]> =>
  (await cli<Array<{ ptyId: string; taskNumber?: number | null }>>('terminal list', { project: repoPath }))
    .filter((t) => t.taskNumber === taskNumber)
    .map((t) => t.ptyId);

const status = (appPage: Page, ptyId: string) =>
  appPage.evaluate((id) => (window as any).__terminalStore.getState().displayStates[id]?.status, ptyId);

test('a background done hook closes its terminal once its command succeeds, and keeps it open when it fails', async ({
  appPage,
  testRepo,
  cli,
}) => {
  test.setTimeout(60_000);
  const repoPath = testRepo.repoPath;
  await enterProject(appPage, repoPath);

  const runDoneHook = async (name: string, command: string): Promise<{ taskNumber: number; ptyId: string }> => {
    await cli(`hook set done --name Done --command "${command}"`, { project: repoPath });
    const { task } = await cli<{ task: { taskNumber: number } }>(`task create "${name}"`, { project: repoPath });
    await cli(`task start ${task.taskNumber} --skip-hook`, { project: repoPath });
    // The start terminal has to be in the list first, or it reads as the hook's.
    await expect.poll(() => taskTerminals(cli, repoPath, task.taskNumber), { timeout: 10_000 }).toHaveLength(1);
    const before = await taskTerminals(cli, repoPath, task.taskNumber);
    await cli(`task set-status ${task.taskNumber} done --run-hook`, { project: repoPath });
    let ptyId: string | undefined;
    await expect
      .poll(
        async () => (ptyId = (await taskTerminals(cli, repoPath, task.taskNumber)).find((id) => !before.includes(id))),
        { timeout: 15_000 },
      )
      .toBeTruthy();
    return { taskNumber: task.taskNumber, ptyId: ptyId! };
  };

  const passed = await runDoneHook('Tidy on success', 'true');
  await expect.poll(() => status(appPage, passed.ptyId), { timeout: 10_000 }).toBe('success');
  await expect
    .poll(async () => (await taskTerminals(cli, repoPath, passed.taskNumber)).includes(passed.ptyId), {
      timeout: 8_000,
    })
    .toBe(false);

  const failed = await runDoneHook('Stay on failure', 'false');
  await expect.poll(() => status(appPage, failed.ptyId), { timeout: 10_000 }).toBe('error');
  // Past AUTO_CLOSE_GRACE_MS (3s), when a successful one would have closed.
  await appPage.waitForTimeout(4_000);
  expect(await taskTerminals(cli, repoPath, failed.taskNumber)).toContain(failed.ptyId);
});
