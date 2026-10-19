import { test, expect, createTestRepo, enterProject, openBoard } from './fixtures';
import type { Page, Locator, ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

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

  // A shell is a stack of its own, listed in the sidebar under its project.
  const project = appPage.locator(`[data-project-path="${testRepo.repoPath}"]`).locator('..');
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 10_000 });
  await expect(appPage.locator('.project-card--active')).toHaveCount(1);
  await expect(appPage.locator('.terminal-xterm-container').first()).toBeAttached({ timeout: 5_000 });
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(project.locator('[data-sidebar-row]')).toHaveCount(2, { timeout: 10_000 });
  await expect(appPage.locator('.project-card')).toHaveCount(1);

  // Away from the board, ⌘N opens the composer as a sheet over the terminal
  // rather than switching the view out from under you. Dismissed again here —
  // the rest of this test is about the task landing in the column.
  await appPage.keyboard.press(`${modifier}+n`);
  const composerSheet = appPage.locator('[data-testid="composer-sheet"]');
  await expect(composerSheet).toBeVisible({ timeout: 5_000 });
  await appPage.keyboard.press('Escape');
  await expect(composerSheet).toHaveCount(0, { timeout: 5_000 });

  // Closing a shell shows the project's other one; closing the last leaves its board.
  await appPage.keyboard.press(`${modifier}+w`);
  await expect(project.locator('[data-sidebar-row]')).toHaveCount(1, { timeout: 5_000 });
  await expect(appPage.locator('.project-card')).toHaveCount(1);
  await appPage.keyboard.press(`${modifier}+w`);
  await expect(appPage.locator('.project-card')).toHaveCount(0, { timeout: 5_000 });
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });

  // --- Kanban task creation ---

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

  // The bevel is an inset `::before`, so it lands on whichever ancestor is
  // positioned: a static flyout panel wears the surrounding wrapper's box
  // instead, and the lit edge floats off the menu it belongs to.
  const flyout = await appPage.evaluate(() => {
    const panels = [...document.querySelectorAll('.context-menu .glass-bevel')] as HTMLElement[];
    const panel = panels[panels.length - 1];
    const bevel = getComputedStyle(panel, '::before');
    const box = panel.getBoundingClientRect();
    return {
      width: Math.round(box.width) - Math.round(parseFloat(bevel.width)),
      height: Math.round(box.height) - Math.round(parseFloat(bevel.height)),
    };
  });
  // `inset: 0` against the panel's padding box: its border, on each side.
  expect(flyout).toEqual({ width: 2, height: 2 });

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

  // A refresh must land back on the same terminal (its PTY is still alive),
  // which reconnectOrphanedSessions reattaches.
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

test('lifecycle hooks: start hook via drag shows dialog', async ({ appPage, testRepo, cli }) => {
  const repoPath = testRepo.repoPath;

  await enterProject(appPage, repoPath);

  await cli('hook set start --name Start --command "echo starting"', { project: repoPath });

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
  // The terminal it started is listed in the sidebar.
  const terminalRows = appPage.locator(`[data-project-path="${repoPath}"]`).locator('..').locator('[data-sidebar-row]');
  await expect(terminalRows).toHaveCount(1, { timeout: 15_000 });

  // --- Cancel flow: create task 2, drag, cancel dialog ---

  // The composer went back to its resting row when the first task was created.
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
  await expect(terminalRows).toHaveCount(1);

  // --- No dialog after hook deleted ---

  await cli('hook delete start', { project: repoPath });

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

  // Closing the project's only terminal leaves its board.
  await appPage.keyboard.press(`${modifier}+w`);
  await expect(appPage.locator('.project-card')).toHaveCount(0, { timeout: 5_000 });
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
    await appPage.evaluate(
      async (paths: string[]) => {
        for (const p of paths) await window.api.addProject(p);
        const projects = await window.api.refreshProjects();
        (window as any).__appStore.getState().setProjects(projects);
      },
      [testRepo.repoPath, otherRepo.repoPath],
    );

    // A terminal in each project.
    await openBoard(appPage, testRepo.repoPath);
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });

    await openBoard(appPage, otherRepo.repoPath);
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });

    // Reload, so the jump lands on a PTY this renderer reattached rather than spawned.
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

    // The project's board was just visited, so it can lead; the jump is to its shell.
    const shellRow = appPage.locator('[data-testid="palette-row"]', { hasText: 'Shell' });
    await expect(shellRow).toContainText('test-project', { timeout: 5_000 });
    await shellRow.click();

    await expect
      .poll(() => appPage.evaluate(() => (window as any).__appStore.getState().activeProjectPath), { timeout: 20_000 })
      .toBe(testRepo.repoPath);
    await expect(palette).toHaveCount(0, { timeout: 5_000 });
    // Jumping to a terminal shows it, not the board.
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

test('about: the app menu item opens the in-app dialog', async ({ appPage, electronApp }) => {
  test.setTimeout(20_000);

  // The menu item pushes to the renderer, so wait for React to have mounted
  // (and subscribed) before clicking it.
  await expect(appPage.getByText('Start a project')).toBeVisible({ timeout: 10_000 });

  const version = await electronApp.evaluate(({ app, Menu }) => {
    const items = Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items ?? []) ?? [];
    items.find((item) => item.label === `About ${app.name}`)?.click();
    return app.getVersion();
  });

  const dialog = appPage.locator('[data-testid="dialog-overlay"][data-visible="true"] [data-testid="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog).toContainText(`Version ${version}`);
  await expect(dialog.locator('button', { hasText: 'GitHub' })).toBeVisible();

  await appPage.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 3_000 });
});

test('about: opens a window when the last one was closed', async ({ appPage, electronApp }) => {
  // Only macOS keeps the app alive with no windows; elsewhere the last close quits it.
  test.skip(process.platform !== 'darwin', 'macOS-only window lifecycle');
  test.slow(); // boots a second window from cold

  await expect(appPage.getByText('Start a project')).toBeVisible({ timeout: 10_000 });

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect
    .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 8_000 })
    .toBe(0);

  const reopened = electronApp.waitForEvent('window');
  await electronApp.evaluate(({ app, Menu }) => {
    const items = Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items ?? []) ?? [];
    items.find((item) => item.label === `About ${app.name}`)?.click();
  });

  const page = await reopened;
  const dialog = page.locator('[data-testid="dialog-overlay"][data-visible="true"] [data-testid="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
});
