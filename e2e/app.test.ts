import { test, expect } from './fixtures';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test('project mode: terminals, kanban, context menu, and task lifecycle', async ({ appPage, testRepo }) => {
  // Add the test repo as a project via the API (no automatic discovery)
  await appPage.evaluate(async (repoPath) => {
    await window.api.addProject(repoPath);
    await (window as any).refreshProjects();
  }, testRepo.repoPath);
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

  // Click "Open in Terminal" — creates worktree and opens terminal directly (no hooks configured)
  await contextMenu.locator('.task-context-menu-item', { hasText: 'Open in Terminal' }).click();

  // No dialog — kanban should hide and a terminal card should appear directly
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

  // --- Drag todo → in_progress (no hooks): no dialog ---

  // Create a new task
  const input2 = appPage.locator('.kanban-add-input');
  await input2.fill('Drag test task');
  await input2.press('Enter');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  // Drag the task from todo to in_progress column
  const inProgressBody = inProgressColumn.locator('.kanban-column-body');
  await todoColumn.locator('.kanban-card').first().dragTo(inProgressBody);

  // No start hook configured — no dialog should appear
  await appPage.waitForTimeout(1_000);
  await expect(appPage.locator('.modal-overlay--visible .import-dialog')).not.toBeVisible();

  // Task should be in in_progress column
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

  // A terminal should have been created in background (kanban stays visible)
  await expect(appPage.locator('.kanban-board')).toBeVisible();
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
});

test('lifecycle hooks: configure, run, cancel, and drag transitions', async ({ appPage, testRepo }) => {
  const repoPath = testRepo.repoPath;

  // --- Setup: add project, enter project mode, configure hooks ---

  await appPage.evaluate(async (rp) => {
    await window.api.addProject(rp);
    await (window as any).refreshProjects();
  }, repoPath);
  await appPage.locator('.project-row').first().click({ timeout: 15_000 });
  await expect(appPage.locator('body')).toHaveClass(/project-mode/, { timeout: 5_000 });

  // Configure start, review, and cleanup hooks via API
  await appPage.evaluate(async (rp) => {
    await window.api.hooks.save(rp, { id: 'hook-start', type: 'start', name: 'Start', command: 'echo starting' });
    await window.api.hooks.save(rp, { id: 'hook-review', type: 'review', name: 'Review', command: 'echo reviewing' });
    await window.api.hooks.save(rp, { id: 'hook-cleanup', type: 'cleanup', name: 'Cleanup', command: 'echo cleaning' });
  }, repoPath);

  // Open kanban and create task 1
  await appPage.keyboard.press(`${modifier}+n`);
  await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });
  const input = appPage.locator('.kanban-add-input');
  await input.fill('Hook task 1');
  await input.press('Enter');

  const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
  const inProgressColumn = appPage.locator('.kanban-column[data-status="in_progress"]');
  const inReviewColumn = appPage.locator('.kanban-column[data-status="in_review"]');
  const doneColumn = appPage.locator('.kanban-column[data-status="done"]');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  // --- Phase 1: Start hook + Run via drag ---
  // Drag task 1 from todo to in_progress → start dialog with pre-filled command → click "Run"

  const inProgressBody = inProgressColumn.locator('.kanban-column-body');
  await todoColumn.locator('.kanban-card').first().dragTo(inProgressBody);

  const hookDialog = appPage.locator('.modal-overlay--visible .import-dialog');
  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('.import-dialog-title')).toHaveText('Start Task');
  await expect(hookDialog.locator('textarea.start-command-textarea')).toHaveValue('echo starting');

  // Click "Run" — terminal created in background, kanban stays visible
  await hookDialog.locator('.btn-primary', { hasText: /^Run$/ }).click();
  await expect(appPage.locator('.modal-overlay--visible')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.kanban-board')).toBeVisible();
  await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 15_000 });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Phase 2: Start hook + Cancel via drag ---
  // Create task 2 → drag to in_progress → dialog → click "Cancel" → no new terminal

  await input.fill('Hook task 2');
  await input.press('Enter');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  await todoColumn.locator('.kanban-card').first().dragTo(inProgressBody);

  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('.import-dialog-title')).toHaveText('Start Task');

  // Click "Cancel" — no terminal created, task moves to in_progress (worktree was created before dialog)
  await hookDialog.locator('.btn-secondary', { hasText: 'Cancel' }).click();
  await expect(appPage.locator('.modal-overlay--visible')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.project-card')).toHaveCount(1); // still just 1 from Phase 1
  await expect(appPage.locator('.kanban-board')).toBeVisible();
  // Task 2 moved to in_progress (worktree created before dialog shown)
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(2, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Phase 3: Review hook + Run via drag ---
  // Drag task 1 from in_progress to in_review → review dialog → click "Run"

  const inReviewBody = inReviewColumn.locator('.kanban-column-body');
  await inProgressColumn.locator('.kanban-card').filter({ hasText: 'Hook task 1' }).dragTo(inReviewBody);

  // Review dialog should appear with pre-filled command
  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('.import-dialog-title')).toHaveText('Review Task');
  await expect(hookDialog.locator('textarea.start-command-textarea')).toHaveValue('echo reviewing');

  // Click "Run" — terminal in background, kanban stays
  await hookDialog.locator('.btn-primary', { hasText: /^Run$/ }).click();
  await expect(appPage.locator('.modal-overlay--visible')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.kanban-board')).toBeVisible();
  await expect(appPage.locator('.project-card')).toHaveCount(2, { timeout: 15_000 });
  await expect(inReviewColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  // --- Phase 4: No dialog when hook not configured ---
  // Drag task 1 from in_review back to in_progress — no continue hook → no dialog

  await inReviewColumn.locator('.kanban-card').filter({ hasText: 'Hook task 1' }).dragTo(inProgressBody);

  // Wait briefly and verify no dialog appeared
  await appPage.waitForTimeout(1_000);
  await expect(appPage.locator('.modal-overlay--visible .import-dialog')).not.toBeVisible();
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(2, { timeout: 5_000 });
  await expect(inReviewColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Phase 5: Cleanup hook + Run via drag ---
  // Drag task 1 from in_progress to done → existing terminals closed → cleanup dialog → "Run"

  const terminalsBefore = await appPage.locator('.project-card').count();
  const doneBody = doneColumn.locator('.kanban-column-body');
  await inProgressColumn.locator('.kanban-card').filter({ hasText: 'Hook task 1' }).dragTo(doneBody);

  // Cleanup dialog should appear
  await expect(hookDialog).toBeVisible({ timeout: 15_000 });
  await expect(hookDialog.locator('.import-dialog-title')).toHaveText('Done — Cleanup');
  await expect(hookDialog.locator('textarea.start-command-textarea')).toHaveValue('echo cleaning');

  // Click "Run" — terminal in background
  await hookDialog.locator('.btn-primary', { hasText: /^Run$/ }).click();
  await expect(appPage.locator('.modal-overlay--visible')).not.toBeVisible({ timeout: 5_000 });
  await expect(appPage.locator('.kanban-board')).toBeVisible();
  await expect(doneColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  // Task 1's old terminals (from Phase 1 + Phase 3) were closed, cleanup terminal was created
  // Net: terminalsBefore - 2 (task1 terminals) + 1 (cleanup) = terminalsBefore - 1
  await expect(appPage.locator('.project-card')).toHaveCount(terminalsBefore - 1, { timeout: 15_000 });

  // --- Phase 6: No dialog after hook deleted ---
  // Delete review hook → drag task 2 to in_review → no dialog

  await appPage.evaluate(async (rp) => {
    await window.api.hooks.delete(rp, 'review');
  }, repoPath);

  await inProgressColumn.locator('.kanban-card').filter({ hasText: 'Hook task 2' }).dragTo(inReviewBody);

  // Wait briefly and verify no dialog appeared
  await appPage.waitForTimeout(1_000);
  await expect(appPage.locator('.modal-overlay--visible .import-dialog')).not.toBeVisible();
  await expect(inReviewColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0);

  // --- Phase 7: No start dialog after start hook deleted ---
  // Delete start hook → create task 3 → drag todo → in_progress → no dialog

  await appPage.evaluate(async (rp) => {
    await window.api.hooks.delete(rp, 'start');
  }, repoPath);

  await input.fill('Hook task 3');
  await input.press('Enter');
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });

  await todoColumn.locator('.kanban-card').first().dragTo(inProgressBody);

  // No start hook — no dialog should appear
  await appPage.waitForTimeout(1_000);
  await expect(appPage.locator('.modal-overlay--visible .import-dialog')).not.toBeVisible();
  await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(1, { timeout: 5_000 });
  await expect(todoColumn.locator('.kanban-card')).toHaveCount(0);
});
