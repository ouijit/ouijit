import { test, expect, enterProject } from './fixtures';

interface Terminal {
  ptyId: string;
  taskNumber: number | null;
  agentStatus: 'thinking' | 'ready' | null;
}

test('a task runs an agent from its start hook, its edit shows in the diff, and it goes to review', async ({
  appPage,
  cli,
  testRepo,
}) => {
  test.setTimeout(90_000);
  const project = { project: testRepo.repoPath };
  await enterProject(appPage, testRepo.repoPath);
  await appPage.evaluate(
    (rp: string) =>
      window.api.hooks.save(rp, {
        id: 'start',
        type: 'start',
        name: 'Agent',
        command: 'claude "$OUIJIT_TASK_DESCRIPTION"',
      }),
    testRepo.repoPath,
  );

  const { task } = await cli<{ task: { taskNumber: number } }>(
    `task create "Stub it" --prompt "write the stub file"`,
    project,
  );
  await cli(`task start ${task.taskNumber} --run-hook`, project);

  let ptyId = '';
  const terminal = async () => {
    const terminals = await cli<Terminal[]>('terminal list');
    const found = terminals.find((t) => t.taskNumber === task.taskNumber);
    ptyId = found?.ptyId ?? '';
    return found;
  };
  const screen = async () => (await cli<{ text: string }>(`terminal read ${ptyId}`)).text;
  await expect.poll(async () => (await terminal())?.ptyId, { timeout: 15_000 }).toBeTruthy();

  // The hook's prompt makes a turn: thinking while it works, ready once it answers.
  await expect.poll(screen, { timeout: 15_000 }).toContain('STUB_AGENT_READY');
  await expect.poll(async () => (await terminal())?.agentStatus, { intervals: [100] }).toBe('thinking');
  await expect.poll(async () => (await terminal())?.agentStatus, { timeout: 10_000 }).toBe('ready');
  await expect.poll(screen).toContain('heard 1 line(s): write the stub file');

  // Typed into the terminal: Shift+Enter breaks the line rather than sending it.
  await appPage
    .locator('.kanban-card', { hasText: 'Stub it' })
    .locator('div.flex-row', { hasText: '─' })
    .first()
    .click();
  const xterm = appPage.locator(`[data-pty-id="${ptyId}"] .terminal-xterm-container`);
  await xterm.click();
  await appPage.keyboard.type('stub-');
  await appPage.keyboard.press('Shift+Enter');
  await appPage.keyboard.type('done');
  await appPage.keyboard.press('Enter');
  await expect.poll(async () => (await terminal())?.agentStatus, { intervals: [100] }).toBe('thinking');
  await expect.poll(screen, { timeout: 10_000 }).toContain('heard 2 line(s): stub- | done');
  await expect.poll(async () => (await terminal())?.agentStatus, { timeout: 10_000 }).toBe('ready');

  await appPage.keyboard.press('Control+c');
  await expect.poll(screen).toContain('STUB_AGENT_EXITED');

  await cli(`diff open ${ptyId}`);
  await expect(appPage.locator('.diff-card[data-path="stub-agent.md"]')).toBeVisible({ timeout: 15_000 });

  await cli(`task set-status ${task.taskNumber} in_review --skip-hook`, project);
  await expect
    .poll(async () => (await cli<{ status: string }>(`task get ${task.taskNumber}`, project)).status)
    .toBe('in_review');
});
