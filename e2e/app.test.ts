import { test, expect } from './fixtures';

test.describe('project discovery and navigation', () => {
  test('discovers project and navigates to project mode', async ({ appPage }) => {
    // Wait for the project to appear in the grid (scanner runs async)
    const projectRow = appPage.locator('.project-row').first();
    await expect(projectRow).toBeVisible({ timeout: 15_000 });

    // Verify the test project name is displayed
    await expect(appPage.locator('.project-name').first()).toContainText('test-project');

    // Click the project row to enter project mode
    await projectRow.click();

    // Verify project mode is active (body gets class, header appears)
    await expect(appPage.locator('body')).toHaveClass(/project-mode/, { timeout: 5_000 });
    await expect(appPage.locator('.project-header-content')).toBeVisible();

    // Press Escape to return to project grid
    await appPage.keyboard.press('Escape');

    // Verify we're back to the grid (project-mode class removed)
    await expect(appPage.locator('body')).not.toHaveClass(/project-mode/, { timeout: 5_000 });
    await expect(appPage.locator('.project-row').first()).toBeVisible();
  });
});

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
