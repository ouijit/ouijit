import { test, expect, createTestRepo } from './fixtures';
import type { Page, Locator, ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Helper: add a project and enter project mode.
 * Hovers the sidebar trigger zone to reveal the auto-hiding sidebar,
 * then clicks the project icon to navigate into project mode.
 */
async function enterProject(appPage: Page, repoPath: string): Promise<void> {
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

/**
 * Helper: navigate into an already-registered project by path. `enterProject`
 * takes the first sidebar item, which is ambiguous once more than one project
 * is registered.
 */
async function enterProjectByPath(appPage: Page, repoPath: string): Promise<void> {
  await appPage.mouse.move(2, 200);
  const sidebarItem = appPage.locator(`[data-project-path="${repoPath}"]`);
  await expect(sidebarItem).toBeVisible({ timeout: 10_000 });
  await sidebarItem.click();
}

/**
 * Helper: dismiss the kanban board. Board/stack toggling is owned by
 * Cmd/Ctrl+T (Escape is reserved for form-level resets), so toggle with that.
 */
async function dismissKanban(appPage: Page): Promise<void> {
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.kanban-board')).toHaveCount(0, { timeout: 5_000 });
}

/**
 * Helper: open the Todo column's composer and hand back its title field.
 *
 * The composer rests as a collapsed row and only becomes a field when asked
 * for, so a test that means to type a task name has to open it first. ⌘N is
 * the way in, and it reaches the column only while the board is up — off the
 * board the same key opens the composer as a sheet instead.
 */
async function openColumnComposer(appPage: Page): Promise<Locator> {
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });
  await appPage.keyboard.press(`${modifier}+n`);
  const input = appPage.locator('.kanban-add-input');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeFocused();
  return input;
}

/**
 * Helper: pick a leaf entry out of a context-menu submenu ("Open in ▸ Terminal").
 * The flyout is a CSS hover state on its parent row, so the parent has to be
 * hovered before the leaf exists as a click target.
 */
async function chooseSubmenuItem(appPage: Page, parentLabel: string, itemLabel: string): Promise<void> {
  const menu = appPage.locator('.context-menu--visible');
  await expect(menu).toBeVisible({ timeout: 5_000 });
  // Exact names throughout: the menu also lists the task's own terminals by
  // label, and a task named "Editor task" otherwise collides with "Editor".
  await menu.getByRole('button', { name: parentLabel, exact: true }).hover();
  await menu.getByRole('button', { name: itemLabel, exact: true }).click();
}

/**
 * Helper: drag a kanban card to a target column using mouse events.
 * dnd-kit uses pointer events; requires mouse simulation.
 * Only reliable for adjacent-column drags (todo → in_progress).
 */
async function dragCard(appPage: Page, source: Locator, target: Locator): Promise<void> {
  await expect(source).toBeAttached({ timeout: 5_000 });

  const srcBox = await source.boundingBox();
  const tgtBox = await target.boundingBox();
  if (!srcBox || !tgtBox) throw new Error('Could not get bounding boxes for drag');

  const srcX = srcBox.x + srcBox.width / 2;
  const srcY = srcBox.y + srcBox.height / 2;
  const tgtX = tgtBox.x + tgtBox.width / 2;
  const tgtY = tgtBox.y + tgtBox.height / 2;

  await appPage.mouse.move(srcX, srcY);
  await appPage.waitForTimeout(50);
  await appPage.mouse.down();
  await appPage.mouse.move(srcX, srcY + 15, { steps: 5 });
  await appPage.waitForTimeout(300);
  const steps = Math.max(20, Math.round(Math.abs(tgtX - srcX) / 5));
  await appPage.mouse.move(tgtX, tgtY, { steps });
  await appPage.waitForTimeout(300);
  await appPage.mouse.up();
  await appPage.waitForTimeout(100);
}

test('project mode: terminals, kanban, context menu, and task lifecycle', async ({ appPage, testRepo }) => {
  await enterProject(appPage, testRepo.repoPath);

  // --- Terminal lifecycle ---

  await dismissKanban(appPage);

  // Empty state visible
  await expect(appPage.locator('.project-stack-empty--visible')).toBeAttached({ timeout: 5_000 });
  await expect(appPage.locator('.project-stack-empty--visible')).toContainText('No active terminals');

  // Open first terminal (Cmd+I)
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 10_000 });
  await expect(appPage.locator('.project-card--active')).toHaveCount(1);
  await expect(appPage.locator('.terminal-xterm-container').first()).toBeAttached({ timeout: 5_000 });
  await expect(appPage.locator('.project-stack-empty--visible')).toHaveCount(0);

  // Open second terminal
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-card')).toHaveCount(2, { timeout: 10_000 });
  await expect(appPage.locator('.project-card--active')).toHaveCount(1);

  // Switch to first terminal (Cmd+1)
  await appPage.keyboard.press(`${modifier}+1`);
  const firstCard = appPage.locator('.project-card').first();
  await expect(firstCard).toHaveClass(/project-card--active/);

  // Open 3 more terminals (5 total, fills page 1)
  for (let i = 0; i < 3; i++) {
    await appPage.keyboard.press(`${modifier}+i`);
  }
  await expect(appPage.locator('.project-card')).toHaveCount(5, { timeout: 10_000 });

  // Open 6th terminal — triggers pagination, new terminal on page 2
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-stack-pagination')).toBeAttached({ timeout: 5_000 });
  await expect(appPage.locator('.project-stack-page-indicator')).toHaveText('2 / 2');
  // Only 1 card visible on page 2
  await expect(appPage.locator('.project-card')).toHaveCount(1);

  // Navigate to page 1 — should show 5 cards
  await appPage.keyboard.press(`${modifier}+Shift+ArrowLeft`);
  await expect(appPage.locator('.project-stack-page-indicator')).toHaveText('1 / 2');
  await expect(appPage.locator('.project-card')).toHaveCount(5, { timeout: 5_000 });

  // Close all terminals
  const maxCloses = 10;
  for (let i = 0; i < maxCloses; i++) {
    const count = await appPage.locator('.project-card').count();
    if (count === 0) break;
    await appPage.keyboard.press(`${modifier}+w`);
    await appPage.waitForTimeout(200);
  }
  await expect(appPage.locator('.project-card')).toHaveCount(0);

  // Empty state returns
  await expect(appPage.locator('.project-stack-empty--visible')).toBeAttached({ timeout: 5_000 });

  // --- Kanban task creation ---

  // Away from the board, ⌘N opens the composer as a sheet over the terminals
  // rather than switching the view out from under you. Dismissed again here —
  // the rest of this test is about the task landing in the column.
  await appPage.keyboard.press(`${modifier}+n`);
  const composerSheet = appPage.locator('[data-testid="composer-sheet"]');
  await expect(composerSheet).toBeVisible({ timeout: 5_000 });
  await appPage.keyboard.press('Escape');
  await expect(composerSheet).toHaveCount(0, { timeout: 5_000 });

  await appPage.keyboard.press(`${modifier}+t`);
  const input = await openColumnComposer(appPage);
  await input.fill('E2E test task');
  await input.press('Enter');

  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  const taskCard = todoColumn.locator('.kanban-card-name', { hasText: 'E2E test task' });
  await expect(taskCard).toBeVisible({ timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-column-count')).toContainText('1');

  const inProgressColumn = appPage.locator('.kanban-column[data-status="in_progress"]');
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Context menu: open task in terminal ---

  const kanbanCard = todoColumn.locator('.kanban-card').first();
  await kanbanCard.click({ button: 'right' });

  const contextMenu = appPage.locator('.context-menu--visible');
  await expect(contextMenu).toBeVisible({ timeout: 5_000 });
  await expect(contextMenu.getByRole('button', { name: 'Open in', exact: true })).toBeVisible();

  // "Move to ▸" carries the column moves plus the danger Trash entry.
  await contextMenu.getByRole('button', { name: 'Move to', exact: true }).hover();
  await expect(contextMenu.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(contextMenu.locator('.context-menu-item--danger', { hasText: 'Trash' })).toBeVisible();

  await chooseSubmenuItem(appPage, 'Open in', 'Terminal');

  await expect(appPage.locator('.kanban-board')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
  await expect(appPage.locator('.project-card--active')).toHaveCount(1);

  // Task should have moved to in_progress — reopen kanban to verify
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1);
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Context menu: trash task ---

  const ipCard = inProgressColumn.locator('.kanban-card').first();
  await ipCard.click({ button: 'right' });
  await expect(appPage.locator('.context-menu--visible')).toBeVisible({ timeout: 5_000 });

  await chooseSubmenuItem(appPage, 'Move to', 'Trash');

  // Trashing removes the card from the board immediately, no confirmation
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
});

test('terminal reconnect after reload does not produce % artifacts', async ({ appPage, testRepo }) => {
  // Shell init, renderer reload, and PTY reconnection each cost real time and
  // overrun the 10s default; give this flow room to finish.
  test.setTimeout(40_000);

  await enterProject(appPage, testRepo.repoPath);
  await dismissKanban(appPage);

  // Open a terminal
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-card--active')).toHaveCount(1, { timeout: 10_000 });
  await expect(appPage.locator('.terminal-xterm-container').first()).toBeAttached({ timeout: 5_000 });

  // Wait for shell to initialize
  await appPage.waitForTimeout(2_000);

  // Type a marker command so we can identify terminal content
  await appPage.keyboard.type('echo RECONNECT_MARKER');
  await appPage.keyboard.press('Enter');
  await appPage.waitForTimeout(1_000);

  // Reload the renderer
  await appPage.reload();
  await appPage.waitForLoadState('domcontentloaded');

  // A refresh must land back in the same project view (its PTYs are still
  // alive), and reconnectOrphanedSessions reattaches and refocuses the terminal.
  await expect(appPage.locator('.project-card--active')).toHaveCount(1, { timeout: 15_000 });
  // Exactly one card — reconnect must not duplicate the shared session.
  await expect(appPage.locator('.project-card')).toHaveCount(1);
  await expect(appPage.locator('.terminal-xterm-container').first()).toBeAttached({ timeout: 5_000 });

  // Wait for reconnection and any resize events to settle
  await appPage.waitForTimeout(3_000);

  // Read the terminal's visible text content
  // xterm renders rows in .xterm-rows; text is accessible via textContent
  const terminalText = await appPage.evaluate(() => {
    const rows = document.querySelector('.terminal-xterm-container .xterm-rows');
    return rows?.textContent ?? '';
  });

  // The marker should be present (reconnection replayed the buffer)
  expect(terminalText).toContain('RECONNECT_MARKER');

  // Count '%' characters that appear as PROMPT_EOL_MARK (full-width-padded lines)
  // These appear as '%' followed by spaces filling the rest of the line
  const percentArtifacts = (terminalText.match(/%\s{10,}/g) || []).length;
  expect(percentArtifacts, `Found ${percentArtifacts} PROMPT_EOL_MARK artifacts after reload`).toBe(0);
});

test('lifecycle hooks: start hook via drag shows dialog', async ({ appPage, testRepo }) => {
  const repoPath = testRepo.repoPath;

  await enterProject(appPage, repoPath);

  // Configure start hook
  await appPage.evaluate(async (rp) => {
    await window.api.hooks.save(rp, { id: 'hook-start', type: 'start', name: 'Start', command: 'echo starting' });
  }, repoPath);

  // Create a task — entering the project already left the board up
  const input = await openColumnComposer(appPage);
  await input.fill('Hook task');
  await input.press('Enter');

  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  const inProgressColumn = appPage.locator('.kanban-column[data-status="in_progress"]');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  // Drag todo → in_progress — start hook dialog should appear
  const inProgressBody = inProgressColumn.locator('.kanban-column-body');
  await dragCard(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);

  const hookDialog = appPage.locator('[data-testid="dialog-overlay"][data-visible="true"] [data-testid="dialog"]');
  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('[data-testid="dialog-title"]')).toHaveText('Start Task');
  await expect(hookDialog.locator('[data-testid="hook-command-textarea"]')).toHaveValue('echo starting');

  // Click "Run" — terminal created in background, task moves to in_progress
  await hookDialog.locator('[data-testid="dialog-run"]').click();
  await expect(appPage.locator('[data-testid="dialog-overlay"][data-visible="true"]')).not.toBeVisible({
    timeout: 5_000,
  });
  // Kanban stays visible for background run — verify task moved
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
  // Toggle to terminal view to verify terminal was created
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
  // Toggle back to kanban for the next steps
  await appPage.keyboard.press(`${modifier}+t`);

  // --- Cancel flow: create task 2, drag, cancel dialog ---

  // The composer went back to its resting row when the first task was created,
  // and again when the board remounted behind the terminal toggle.
  await openColumnComposer(appPage);
  await input.fill('Hook task 2');
  await input.press('Enter');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  await dragCard(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);

  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('[data-testid="dialog-title"]')).toHaveText('Start Task');

  // Click "Cancel" — an explicit "don't run the hook, don't open a terminal".
  // The task still moves to in_progress (worktree already created), but no
  // terminal is spawned and the loading slot is removed.
  await hookDialog.locator('[data-testid="dialog-cancel"]').click();
  await expect(appPage.locator('[data-testid="dialog-overlay"][data-visible="true"]')).not.toBeVisible({
    timeout: 5_000,
  });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(2, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
  // No new terminal was created — still just the one from the Run flow earlier.
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.project-card')).toHaveCount(1);
  await appPage.keyboard.press(`${modifier}+t`);

  // --- No dialog after hook deleted ---

  await appPage.evaluate(async (rp) => {
    await window.api.hooks.delete(rp, 'start');
  }, repoPath);

  await openColumnComposer(appPage);
  await input.fill('Hook task 3');
  await input.press('Enter');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  await dragCard(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);

  await appPage.waitForTimeout(1_000);
  await expect(
    appPage.locator('[data-testid="dialog-overlay"][data-visible="true"] [data-testid="dialog"]'),
  ).not.toBeVisible();
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(3, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
});

test('missing worktree: recovery dialog recreates worktree on open', async ({ appPage, testRepo }) => {
  const repoPath = testRepo.repoPath;
  await enterProject(appPage, repoPath);

  // Create a task and open it in terminal (creates worktree, moves to in_progress)
  const input = await openColumnComposer(appPage);
  await input.fill('Recovery task');
  await input.press('Enter');

  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  // Open in terminal via context menu
  const kanbanCard = todoColumn.locator('.kanban-card').first();
  await kanbanCard.click({ button: 'right' });
  await chooseSubmenuItem(appPage, 'Open in', 'Terminal');
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });

  // Get the worktree path from the task data
  const worktreePath = await appPage.evaluate(async (rp: string) => {
    const tasks = await window.api.task.getAll(rp);
    return tasks.find((t: any) => t.name === 'Recovery task')?.worktreePath;
  }, repoPath);
  expect(worktreePath).toBeTruthy();

  // Delete the worktree directory to simulate external deletion
  fs.rmSync(worktreePath, { recursive: true, force: true });
  expect(fs.existsSync(worktreePath)).toBe(false);

  // Close the terminal so we can reopen from kanban
  await appPage.keyboard.press(`${modifier}+w`);
  await expect(appPage.locator('.project-card')).toHaveCount(0, { timeout: 5_000 });

  // Open kanban
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });

  const inProgressColumn = appPage.locator('.kanban-column[data-status="in_progress"]');
  const ipCard = inProgressColumn.locator('.kanban-card').first();
  await expect(ipCard).toBeVisible({ timeout: 5_000 });

  // Try to open the task again — should show recovery dialog
  await ipCard.click({ button: 'right' });
  await chooseSubmenuItem(appPage, 'Open in', 'Terminal');

  // Recovery dialog should appear
  const recoveryDialog = appPage.locator('[data-testid="dialog-overlay"][data-visible="true"] [data-testid="dialog"]');
  await expect(recoveryDialog).toBeVisible({ timeout: 10_000 });
  await expect(recoveryDialog.locator('[data-testid="dialog-title"]')).toHaveText('Worktree Not Found');
  await expect(recoveryDialog).toContainText('Recovery task');

  // Click "Recreate Worktree"
  await recoveryDialog.locator('[data-testid="dialog-recover"]').click();
  await expect(recoveryDialog).not.toBeVisible({ timeout: 5_000 });

  // Terminal should open successfully with recovered worktree
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });

  // Verify the worktree directory was recreated
  const newWorktreePath = await appPage.evaluate(async (rp: string) => {
    const tasks = await window.api.task.getAll(rp);
    return tasks.find((t: any) => t.name === 'Recovery task')?.worktreePath;
  }, repoPath);
  expect(newWorktreePath).toBeTruthy();
  expect(fs.existsSync(newWorktreePath)).toBe(true);
});

test('open in editor: starts a never-started task, asks for an editor, and runs it in the worktree', async ({
  appPage,
  testRepo,
}) => {
  test.slow(); // creates a worktree, spawns a terminal, polls for a side-effect file
  const repoPath = testRepo.repoPath;

  // A stand-in editor that records the directory it is launched with. It runs
  // in a task terminal rather than a detached spawn, which is the only way a
  // terminal editor (Helix, Vim) gets the TTY it needs to render.
  const fixtureDir = path.dirname(repoPath); // cleaned up by the testRepo fixture
  const fakeEditor = path.join(fixtureDir, 'fake-editor.sh');
  const markerFile = path.join(fixtureDir, 'editor-arg.txt');
  fs.writeFileSync(fakeEditor, `#!/bin/sh\nprintf '%s' "$1" > '${markerFile}'\n`);
  fs.chmodSync(fakeEditor, 0o755);

  await enterProject(appPage, repoPath);

  const input = await openColumnComposer(appPage);
  await input.fill('Editor task');
  await input.press('Enter');

  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await todoColumn.locator('.kanban-card').first().click({ button: 'right' });
  await chooseSubmenuItem(appPage, 'Open in', 'Editor');

  const command = appPage.locator('#hook-command');
  await expect(command).toBeVisible({ timeout: 5_000 });
  await command.fill(fakeEditor);
  await appPage.getByRole('button', { name: 'Save' }).click();

  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });

  const worktreePath = await appPage.evaluate(async (rp: string) => {
    const tasks = await window.api.task.getAll(rp);
    return tasks.find((t: any) => t.name === 'Editor task')?.worktreePath as string | undefined;
  }, repoPath);
  expect(worktreePath).toBeTruthy();

  await expect
    .poll(() => (fs.existsSync(markerFile) ? fs.readFileSync(markerFile, 'utf8') : null), { timeout: 15_000 })
    .toBe(worktreePath);
});

/**
 * Everything here is out of reach of the jsdom suite: a real xterm competing
 * for the keystroke, a real second PTY that this renderer has not hydrated,
 * and real focus landing on a terminal after the jump.
 */
test('command palette: opens over a focused terminal and jumps to a session in another project', async ({
  appPage,
  testRepo,
}) => {
  // Two shells, a renderer reload and a PTY reconnect — well past the default.
  test.setTimeout(60_000);

  const otherRepo = createTestRepo('other-project');
  try {
    await appPage.evaluate(async (paths: string[]) => {
      for (const p of paths) await window.api.addProject(p);
      const projects = await window.api.refreshProjects();
      (window as any).__appStore.getState().setProjects(projects);
    }, [testRepo.repoPath, otherRepo.repoPath]);

    // A terminal in each project.
    await enterProjectByPath(appPage, testRepo.repoPath);
    await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 10_000 });
    await dismissKanban(appPage);
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });

    await enterProjectByPath(appPage, otherRepo.repoPath);
    await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 10_000 });
    await dismissKanban(appPage);
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });

    // Reload so the first project's PTY is still alive but no longer hydrated
    // in this renderer. The palette has to source it from getActiveSessions and
    // reconnect it on the way in — the path the unit suite can only mock.
    await appPage.reload();
    await appPage.waitForLoadState('domcontentloaded');
    await expect(appPage.locator('.project-card--active')).toHaveCount(1, { timeout: 30_000 });
    await appPage.waitForTimeout(3_000);

    // Put the keystroke in the hardest place for it to survive: a focused xterm.
    await appPage.locator('.terminal-xterm-container').first().click();
    await appPage.keyboard.type('PALETTE_MARKER');
    await appPage.waitForTimeout(500);

    await appPage.keyboard.press(`${modifier}+k`);
    const palette = appPage.locator('[data-testid="command-palette"]');
    await expect(palette).toBeVisible({ timeout: 5_000 });

    // The shell must not have received the `k` as input.
    const shellText = await appPage.evaluate(
      () => document.querySelector('.terminal-xterm-container .xterm-rows')?.textContent ?? '',
    );
    expect(shellText).toContain('PALETTE_MARKER');
    expect(shellText, 'the `k` leaked into the terminal instead of opening the palette').not.toContain(
      'PALETTE_MARKERk',
    );

    // Typing right after the open transition must survive it.
    const input = appPage.getByLabel('Search terminals, projects and tasks');
    await expect(input).toBeFocused({ timeout: 5_000 });
    await appPage.keyboard.type('test-project');
    await expect(input).toHaveValue('test-project');

    // Terminals rank above projects, so the top row is the other project's
    // shell, not the project itself.
    const firstRow = appPage.locator('[data-testid="palette-row"]').first();
    await expect(firstRow).toContainText('test-project', { timeout: 5_000 });
    await appPage.keyboard.press('Enter');

    await expect
      .poll(() => appPage.evaluate(() => (window as any).__appStore.getState().activeProjectPath), { timeout: 20_000 })
      .toBe(testRepo.repoPath);
    await expect(palette).toHaveCount(0, { timeout: 5_000 });
    // Jumping to a terminal shows terminals, not the board.
    await expect(appPage.locator('.kanban-board')).toHaveCount(0);
    await expect(appPage.locator('.project-card--active')).toHaveCount(1, { timeout: 20_000 });

    // Focus has to land in the terminal, or the jump isn't finished.
    await expect
      .poll(() => appPage.evaluate(() => !!document.activeElement?.closest('.terminal-xterm-container')), {
        timeout: 10_000,
      })
      .toBe(true);

    // Escape closes without navigating.
    await appPage.keyboard.press(`${modifier}+k`);
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await appPage.keyboard.press('Escape');
    await expect(palette).toHaveCount(0, { timeout: 5_000 });
    expect(await appPage.evaluate(() => (window as any).__appStore.getState().activeProjectPath)).toBe(
      testRepo.repoPath,
    );
  } finally {
    otherRepo.cleanup();
  }
});

test('whats new: modal appears and dismisses', async ({ appPage }) => {
  // Trigger the What's New modal via store (same as the IPC listener does)
  await appPage.evaluate(() => {
    (window as any).__appStore.getState().setWhatsNew({
      version: '1.1.0',
      notes:
        '## Improvements\n- **Faster startup** with lazy loading\n- Fixed `bug #42` in terminal\n\n## Bug Fixes\n- Resolved crash on exit',
    });
  });

  // Modal should appear
  const dialog = appPage.locator('[data-testid="dialog-overlay"][data-visible="true"] [data-testid="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog).toContainText("What's New");
  await expect(dialog).toContainText('v1.1.0');
  await expect(dialog).toContainText('Faster startup');
  await expect(dialog).toContainText('Bug Fixes');

  // Click "Got it" to dismiss
  await dialog.locator('button', { hasText: 'Got it' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 3_000 });

  // Store should be cleared (after 200ms dismiss animation)
  await appPage.waitForFunction(() => (window as any).__appStore.getState().whatsNew === null, null, {
    timeout: 3_000,
  });
});

test('whats new: modal dismisses on Escape', async ({ appPage }) => {
  await appPage.evaluate(() => {
    (window as any).__appStore.getState().setWhatsNew({
      version: '2.0.0',
      notes: '- Major update',
    });
  });

  const dialog = appPage.locator('[data-testid="dialog-overlay"][data-visible="true"] [data-testid="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  await appPage.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 3_000 });
});

test('update available: persistent toast with download action', async ({ appPage }) => {
  // Trigger the update-available toast via store (same as the IPC listener does)
  await appPage.evaluate(() => {
    (window as any).__projectStore.getState().addToast('Version 1.1.0 is available', {
      type: 'info',
      persistent: true,
      actionLabel: 'Download',
      onAction: () => {},
    });
  });

  // Toast should appear with action button
  const toast = appPage.locator('.fixed.bottom-6');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast).toContainText('Version 1.1.0 is available');

  const downloadBtn = toast.locator('button', { hasText: 'Download' });
  await expect(downloadBtn).toBeVisible();

  // Toast should NOT auto-dismiss (persistent) — wait past the 4s timeout
  await appPage.waitForTimeout(5_000);
  await expect(toast).toBeVisible();

  // Dismiss via close button (renders an SVG Icon, labelled for a11y)
  const closeBtn = toast.locator('button[aria-label="Dismiss"]');
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await expect(toast).not.toBeVisible({ timeout: 3_000 });
});
