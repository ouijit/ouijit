import { test, expect } from './fixtures';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test('project mode: terminals, kanban, context menu, and task lifecycle', async ({ appPage }) => {
  // Enter project mode
  await appPage.locator('.project-row').first().click({ timeout: 15_000 });
  await expect(appPage.locator('body')).toHaveClass(/project-mode/, { timeout: 5_000 });

  // --- Terminal lifecycle ---

  // Dismiss the kanban board (shown by default) so empty state and terminals are visible
  await appPage.keyboard.press(`${modifier}+b`);
  await expect(appPage.locator('.kanban-board')).not.toBeVisible({ timeout: 5_000 });

  // Empty state visible
  await expect(appPage.locator('.project-stack-empty--visible')).toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.project-stack-empty--visible')).toContainText('No active terminals');

  // Open first terminal (Cmd+I)
  await appPage.keyboard.press(`${modifier}+i`);
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 10_000 });
  await expect(appPage.locator('.project-card--active')).toBeVisible();
  await expect(appPage.locator('.terminal-xterm-container')).toBeVisible();
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
  await expect(appPage.locator('.project-stack-pagination')).toBeVisible({ timeout: 5_000 });
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
  await expect(appPage.locator('.project-stack-empty--visible')).toBeVisible({ timeout: 5_000 });

  // --- Kanban task creation ---

  // Open kanban and focus input (Cmd+N)
  await appPage.keyboard.press(`${modifier}+n`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });

  // Create a task
  const input = appPage.locator('.kanban-add-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill('E2E test task');
  await input.press('Enter');

  // Verify task appears in the todo column with correct count
  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  const taskCard = todoColumn.locator('.kanban-card-name', { hasText: 'E2E test task' });
  await expect(taskCard).toBeVisible({ timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-column-count')).toContainText('1');

  // Verify other columns are empty
  const inProgressColumn = appPage.locator('.kanban-column[data-status="in_progress"]');
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Context menu: open task in terminal ---

  // Right-click the task card to open context menu
  const kanbanCard = todoColumn.locator('.kanban-card').first();
  await kanbanCard.click({ button: 'right' });

  // Verify context menu appears with expected items
  const contextMenu = appPage.locator('.task-context-menu--visible');
  await expect(contextMenu).toBeVisible({ timeout: 5_000 });
  await expect(contextMenu.locator('.task-context-menu-item', { hasText: 'Open in Terminal' })).toBeVisible();
  await expect(contextMenu.locator('.task-context-menu-item', { hasText: 'Move to Done' })).toBeVisible();
  await expect(contextMenu.locator('.task-context-menu-item--danger', { hasText: 'Delete' })).toBeVisible();

  // Click "Open in Terminal" — creates worktree and opens terminal
  await contextMenu.locator('.task-context-menu-item', { hasText: 'Open in Terminal' }).click();

  // Kanban should hide and a terminal card should appear
  await expect(appPage.locator('.kanban-board')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
  await expect(appPage.locator('.project-card--active')).toBeVisible();

  // Task should have moved to in_progress — reopen kanban to verify
  await appPage.keyboard.press(`${modifier}+b`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1);
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Context menu: delete task ---

  // Right-click the task (now in in_progress column) to open context menu
  const ipCard = inProgressColumn.locator('.kanban-card').first();
  await ipCard.click({ button: 'right' });
  await expect(appPage.locator('.task-context-menu--visible')).toBeVisible({ timeout: 5_000 });

  // Click "Delete"
  await appPage.locator('.task-context-menu-item--danger', { hasText: 'Delete' }).click();

  // Confirm deletion in the modal dialog
  const deleteDialog = appPage.locator('.modal-overlay--visible');
  await expect(deleteDialog).toBeVisible({ timeout: 5_000 });
  await expect(deleteDialog.locator('.import-dialog-title')).toHaveText('Delete Task?');
  await deleteDialog.locator('[data-action="delete"]').click();

  // Task should be gone from the board
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
});
