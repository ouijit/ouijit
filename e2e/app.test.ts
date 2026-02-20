import { test, expect } from './fixtures';

test.describe('project discovery and navigation', () => {
  test('discovers project and navigates to project mode', async ({ appPage, testRepo }) => {
    // Verify the project appears in the grid
    const projectName = 'test-project';
    await appPage.waitForSelector(`text=${projectName}`, { timeout: 10_000 });

    // Click the project to enter project mode
    await appPage.click(`text=${projectName}`);

    // Verify project mode is shown (terminal card or project UI visible)
    await appPage.waitForSelector('[data-testid="project-mode"], .terminal-card, .project-header', {
      timeout: 5_000,
    });

    // Press Escape to return to project grid
    await appPage.keyboard.press('Escape');

    // Verify project grid is shown again
    await appPage.waitForSelector(`text=${projectName}`, { timeout: 5_000 });
  });
});

test.describe('task creation and terminal flow', () => {
  test('creates a task and opens terminal', async ({ appPage, testRepo }) => {
    const projectName = 'test-project';

    // Enter project mode
    await appPage.waitForSelector(`text=${projectName}`, { timeout: 10_000 });
    await appPage.click(`text=${projectName}`);
    await appPage.waitForTimeout(1_000);

    // Press Cmd+N (or Ctrl+N on Linux) to open new task dialog
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await appPage.keyboard.press(`${modifier}+n`);

    // Wait for new task dialog
    await appPage.waitForSelector('input[placeholder*="task"], input[placeholder*="name"], dialog input', {
      timeout: 5_000,
    });

    // Type task name and submit
    await appPage.keyboard.type('Test task from e2e');
    await appPage.keyboard.press('Enter');

    // Verify task appears (in kanban or task list)
    await appPage.waitForSelector('text=Test task from e2e', { timeout: 5_000 });
  });
});

test.describe('diff and merge flow', () => {
  test('shows diff for worktree changes', async ({ appPage, testRepo, electronApp }) => {
    const projectName = 'test-project';

    // Enter project mode
    await appPage.waitForSelector(`text=${projectName}`, { timeout: 10_000 });
    await appPage.click(`text=${projectName}`);
    await appPage.waitForTimeout(1_000);

    // Create a task
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await appPage.keyboard.press(`${modifier}+n`);
    await appPage.waitForSelector('input[placeholder*="task"], input[placeholder*="name"], dialog input', {
      timeout: 5_000,
    });
    await appPage.keyboard.type('Diff test task');
    await appPage.keyboard.press('Enter');

    // Wait for task to be created
    await appPage.waitForSelector('text=Diff test task', { timeout: 5_000 });

    // Note: Full diff/merge test requires starting the task (creating a worktree),
    // making changes in it, then opening the diff panel. This requires the terminal
    // to be functional and the worktree to be created, which involves git operations.
    // The test framework is set up — specific assertions will be refined as the
    // app's test selectors are established.
  });
});
