import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Helper: add a project and enter project mode.
 * Uses evaluate to call the renderer's sidebar click handler directly,
 * since the auto-hiding sidebar is overlapped by the home view empty state.
 */
async function enterProject(appPage: Page, repoPath: string): Promise<void> {
  await appPage.evaluate(async (rp: string) => {
    await window.api.addProject(rp);
    await (window as any).refreshProjects();
    const sidebarItem = document.querySelector('.sidebar-item[data-project-path]') as HTMLElement;
    if (sidebarItem) sidebarItem.click();
  }, repoPath);
  await expect(appPage.locator('body')).toHaveClass(/project-mode/, { timeout: 10_000 });
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 10_000 });
}

/**
 * Helper: dismiss the kanban board reliably.
 * Keyboard hotkeys can be flaky in Electron e2e, so we remove DOM directly.
 */
async function dismissKanban(appPage: Page): Promise<void> {
  await appPage.evaluate(() => {
    document.querySelector('.kanban-board')?.remove();
    document.body.classList.remove('kanban-open');
  });
  await expect(appPage.locator('.kanban-board')).toHaveCount(0, { timeout: 5_000 });
}

/**
 * Helper: drag a kanban card to a target column using mouse events.
 * SortableJS uses forceFallback which ignores HTML5 drag; requires mouse simulation.
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
  await expect(appPage.locator('.terminal-xterm-container')).toBeAttached({ timeout: 5_000 });
  await expect(appPage.locator('.project-stack-empty--visible')).toHaveCount(0);

  // Open second terminal
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-card')).toHaveCount(2, { timeout: 10_000 });
  await expect(appPage.locator('.project-card--active')).toHaveCount(1);

  // Switch to first terminal (Cmd+1)
  await appPage.keyboard.press(`${modifier}+1`);
  const firstCard = appPage.locator('.project-card').first();
  await expect(firstCard).toHaveClass(/project-card--active/);

  // Open 4 more terminals (6 total, triggers pagination at page size = 5)
  for (let i = 0; i < 4; i++) {
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(3 + i, { timeout: 10_000 });
  }
  await expect(appPage.locator('.project-card')).toHaveCount(6);

  // Pagination visible — indicator shows "2 / 2"
  await expect(appPage.locator('.project-stack-pagination')).toBeAttached({ timeout: 5_000 });
  await expect(appPage.locator('.project-stack-page-indicator')).toHaveText('2 / 2');

  // Navigate pages — Cmd+Shift+Left → page "1 / 2"
  await appPage.keyboard.press(`${modifier}+Shift+ArrowLeft`);
  await expect(appPage.locator('.project-stack-page-indicator')).toHaveText('1 / 2');

  // Close all terminals
  const maxCloses = 10;
  for (let i = 0; i < maxCloses; i++) {
    const count = await appPage.locator('.project-card').count();
    if (count === 0) break;
    await appPage.keyboard.press(`${modifier}+w`);
    await expect(appPage.locator('.project-card')).toHaveCount(count - 1, { timeout: 5_000 });
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

  const contextMenu = appPage.locator('.task-context-menu--visible');
  await expect(contextMenu).toBeVisible({ timeout: 5_000 });
  await expect(contextMenu.locator('.task-context-menu-item', { hasText: 'Open in Terminal' })).toBeVisible();
  await expect(contextMenu.locator('.task-context-menu-item', { hasText: 'Move to Done' })).toBeVisible();
  await expect(contextMenu.locator('.task-context-menu-item--danger', { hasText: 'Delete' })).toBeVisible();

  await contextMenu.locator('.task-context-menu-item', { hasText: 'Open in Terminal' }).click();

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
  await expect(appPage.locator('.task-context-menu--visible')).toBeVisible({ timeout: 5_000 });

  await appPage.locator('.task-context-menu-item--danger', { hasText: 'Delete' }).click();

  const deleteDialog = appPage.locator('.modal-overlay--visible');
  await expect(deleteDialog).toBeVisible({ timeout: 5_000 });
  await expect(deleteDialog.locator('.dialog-title')).toHaveText('Delete Task?');
  await deleteDialog.locator('[data-action="delete"]').click();

  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
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

  // Click "Run" — terminal created, task moves to in_progress
  await hookDialog.locator('.btn-primary', { hasText: /^Run$/ }).click();
  await expect(appPage.locator('.modal-overlay--visible')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

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
  await expect(appPage.locator('.project-card')).toHaveCount(1); // still just 1
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(2, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

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
