import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';
import * as fs from 'node:fs';

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
 * Helper: dismiss the kanban board by pressing Escape.
 */
async function dismissKanban(appPage: Page): Promise<void> {
  await appPage.keyboard.press('Escape');
  await expect(appPage.locator('.kanban-board')).toHaveCount(0, { timeout: 5_000 });
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

  await appPage.keyboard.press(`${modifier}+n`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });

  const input = appPage.locator('.kanban-add-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
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
  await expect(contextMenu.locator('.context-menu-item', { hasText: 'Open in Terminal' })).toBeVisible();
  await expect(contextMenu.locator('.context-menu-item', { hasText: 'Move to Done' })).toBeVisible();
  await expect(contextMenu.locator('.context-menu-item--danger', { hasText: 'Delete' })).toBeVisible();

  await contextMenu.locator('.context-menu-item', { hasText: 'Open in Terminal' }).click();

  await expect(appPage.locator('.kanban-board')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
  await expect(appPage.locator('.project-card--active')).toHaveCount(1);

  // Task should have moved to in_progress — reopen kanban to verify
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1);
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Context menu: delete task ---

  const ipCard = inProgressColumn.locator('.kanban-card').first();
  await ipCard.click({ button: 'right' });
  await expect(appPage.locator('.context-menu--visible')).toBeVisible({ timeout: 5_000 });

  await appPage.locator('.context-menu-item--danger', { hasText: 'Delete' }).click();

  // React version deletes immediately without confirmation
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
});

test('terminal reconnect after reload does not produce % artifacts', async ({ appPage, testRepo }) => {
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

  // Wait for terminal reconnection — project view should restore
  await expect(appPage.locator('.project-card--active')).toHaveCount(1, { timeout: 15_000 });
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

  // Open kanban and create a task
  await appPage.keyboard.press(`${modifier}+n`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });
  const input = appPage.locator('.kanban-add-input');
  await input.fill('Hook task');
  await input.press('Enter');

  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  const inProgressColumn = appPage.locator('.kanban-column[data-status="in_progress"]');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  // Drag todo → in_progress — start hook dialog should appear
  const inProgressBody = inProgressColumn.locator('.kanban-column-body');
  await dragCard(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);

  const hookDialog = appPage.locator('.modal-overlay--visible .dialog');
  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('.dialog-title')).toHaveText('Start Task');
  await expect(hookDialog.locator('textarea.start-command-textarea')).toHaveValue('echo starting');

  // Click "Run" — terminal created in background, task moves to in_progress
  await hookDialog.locator('.btn-primary', { hasText: /^Run$/ }).click();
  await expect(appPage.locator('.modal-overlay--visible')).not.toBeVisible({ timeout: 5_000 });
  // Kanban stays visible for background run — verify task moved
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
  // Toggle to terminal view to verify terminal was created
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
  // Toggle back to kanban for the next steps
  await appPage.keyboard.press(`${modifier}+t`);

  // --- Cancel flow: create task 2, drag, cancel dialog ---

  await input.fill('Hook task 2');
  await input.press('Enter');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  await dragCard(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);

  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('.dialog-title')).toHaveText('Start Task');

  // Click "Cancel" — no terminal, task still moves to in_progress (worktree already created)
  await hookDialog.locator('.btn-secondary', { hasText: 'Cancel' }).click();
  await expect(appPage.locator('.modal-overlay--visible')).not.toBeVisible({ timeout: 5_000 });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(2, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
  // Verify no new terminal was created (still just 1 from earlier)
  await appPage.keyboard.press(`${modifier}+t`);
  await expect(appPage.locator('.project-card')).toHaveCount(1);
  await appPage.keyboard.press(`${modifier}+t`);

  // --- No dialog after hook deleted ---

  await appPage.evaluate(async (rp) => {
    await window.api.hooks.delete(rp, 'start');
  }, repoPath);

  await input.fill('Hook task 3');
  await input.press('Enter');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  await dragCard(appPage, todoColumn.locator('.kanban-card').first(), inProgressBody);

  await appPage.waitForTimeout(1_000);
  await expect(appPage.locator('.modal-overlay--visible .dialog')).not.toBeVisible();
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(3, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
});

test('missing worktree: recovery dialog recreates worktree on open', async ({ appPage, testRepo }) => {
  const repoPath = testRepo.repoPath;
  await enterProject(appPage, repoPath);

  // Create a task and open it in terminal (creates worktree, moves to in_progress)
  const input = appPage.locator('.kanban-add-input');
  await input.fill('Recovery task');
  await input.press('Enter');

  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  // Open in terminal via context menu
  const kanbanCard = todoColumn.locator('.kanban-card').first();
  await kanbanCard.click({ button: 'right' });
  await appPage.locator('.context-menu--visible .context-menu-item', { hasText: 'Open in Terminal' }).click();
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
  await appPage.locator('.context-menu--visible .context-menu-item', { hasText: 'Open in Terminal' }).click();

  // Recovery dialog should appear
  const recoveryDialog = appPage.locator('.modal-overlay--visible .dialog');
  await expect(recoveryDialog).toBeVisible({ timeout: 10_000 });
  await expect(recoveryDialog.locator('.dialog-title')).toHaveText('Worktree Not Found');
  await expect(recoveryDialog).toContainText('Recovery task');

  // Click "Recreate Worktree"
  await recoveryDialog.locator('.btn-primary', { hasText: 'Recreate Worktree' }).click();
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
