import { test, expect } from './fixtures';

test.describe('task creation and kanban', () => {
  test('creates a task via kanban input', async ({ appPage }) => {
    // Enter project mode
    await appPage.locator('.project-row').first().click({ timeout: 15_000 });
    await expect(appPage.locator('body')).toHaveClass(/project-mode/, { timeout: 5_000 });

    // Press Cmd+N (Ctrl+N on Linux) to show kanban and focus input
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await appPage.keyboard.press(`${modifier}+n`);

    // Wait for the kanban board to appear
    await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });

    // Type task name in the add input and submit
    const input = appPage.locator('.kanban-add-input');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill('E2E test task');
    await input.press('Enter');

    // Verify task card appears in the todo column
    const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
    await expect(
      todoColumn.locator('.kanban-card-name', { hasText: 'E2E test task' })
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('terminal lifecycle', () => {
  test('creates, switches, paginates, and closes terminals', async ({ appPage }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // 1. Enter project mode
    await appPage.locator('.project-row').first().click({ timeout: 15_000 });
    await expect(appPage.locator('body')).toHaveClass(/project-mode/, { timeout: 5_000 });

    // Dismiss the kanban board (shown by default) so empty state and terminals are visible
    await appPage.keyboard.press(`${modifier}+b`);
    await expect(appPage.locator('.kanban-board')).not.toBeVisible({ timeout: 5_000 });

    // 2. Empty state — verify visible with correct text
    await expect(appPage.locator('.project-stack-empty--visible')).toBeVisible({ timeout: 5_000 });
    await expect(appPage.locator('.project-stack-empty--visible')).toContainText('No active terminals');

    // 3. Open first terminal (Cmd+I)
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(1, { timeout: 10_000 });
    await expect(appPage.locator('.project-card--active')).toBeVisible();
    await expect(appPage.locator('.terminal-xterm-container')).toBeVisible();
    // Empty state should be hidden
    await expect(appPage.locator('.project-stack-empty--visible')).toHaveCount(0);

    // 4. Open second terminal (Cmd+I)
    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card')).toHaveCount(2, { timeout: 10_000 });
    // Newest terminal is active
    await expect(appPage.locator('.project-card--active')).toHaveCount(1);

    // 5. Switch to first terminal (Cmd+1)
    await appPage.keyboard.press(`${modifier}+1`);
    // First card (index 0) should now be active
    const firstCard = appPage.locator('.project-card').first();
    await expect(firstCard).toHaveClass(/project-card--active/);

    // 6. Open 4 more terminals (Cmd+I x4) → 6 total, triggers pagination (page size = 5)
    for (let i = 0; i < 4; i++) {
      await appPage.keyboard.press(`${modifier}+i`);
      await expect(appPage.locator('.project-card')).toHaveCount(3 + i, { timeout: 10_000 });
    }
    await expect(appPage.locator('.project-card')).toHaveCount(6);

    // 7. Pagination visible — indicator shows "2 / 2"
    await expect(appPage.locator('.project-stack-pagination')).toBeVisible({ timeout: 5_000 });
    await expect(appPage.locator('.project-stack-page-indicator')).toHaveText('2 / 2');

    // 8. Navigate pages — Cmd+Shift+Left → page "1 / 2"
    await appPage.keyboard.press(`${modifier}+Shift+ArrowLeft`);
    await expect(appPage.locator('.project-stack-page-indicator')).toHaveText('1 / 2');

    // 9. Close terminals until none remain (Cmd+W)
    const maxCloses = 10; // safety limit
    for (let i = 0; i < maxCloses; i++) {
      const count = await appPage.locator('.project-card').count();
      if (count === 0) break;
      await appPage.keyboard.press(`${modifier}+w`);
      // Wait for count to decrease
      await expect(appPage.locator('.project-card')).toHaveCount(count - 1, { timeout: 5_000 });
    }
    await expect(appPage.locator('.project-card')).toHaveCount(0);

    // 10. Empty state returns
    await expect(appPage.locator('.project-stack-empty--visible')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('diff and merge flow', () => {
  test('creates task and verifies kanban column placement', async ({ appPage }) => {
    // Enter project mode
    await appPage.locator('.project-row').first().click({ timeout: 15_000 });
    await expect(appPage.locator('body')).toHaveClass(/project-mode/, { timeout: 5_000 });

    // Open kanban
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await appPage.keyboard.press(`${modifier}+n`);
    await expect(appPage.locator('.kanban-board')).toBeVisible({ timeout: 5_000 });

    // Create a task
    const input = appPage.locator('.kanban-add-input');
    await input.fill('Diff test task');
    await input.press('Enter');

    // Verify the task appears in the correct column (todo)
    const todoColumn = appPage.locator('.kanban-column[data-status="todo"]');
    await expect(
      todoColumn.locator('.kanban-card-name', { hasText: 'Diff test task' })
    ).toBeVisible({ timeout: 5_000 });

    // Verify the task count updates
    await expect(todoColumn.locator('.kanban-column-count')).toContainText('1');

    // Verify other columns are empty
    const inProgressColumn = appPage.locator('.kanban-column[data-status="in_progress"]');
    await expect(inProgressColumn.locator('.kanban-card')).toHaveCount(0);
  });
});
