import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { CombinedHookConfigDialog } from '../../components/dialogs/CombinedHookConfigDialog';
import { HookConfigDialog } from '../../components/dialogs/HookConfigDialog';
import { OnboardingPanel } from '../../components/kanban/OnboardingPanel';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import type { HealthStatus } from '../../healthCheck';
import type { TaskWithWorkspace } from '../../types';

const openCodeOnly: HealthStatus = {
  git: true,
  claude: false,
  codex: false,
  pi: false,
  opencode: true,
  nono: false,
  gh: false,
  ghVersionOk: false,
};

test('hook examples use opencode when claude is not installed', async () => {
  const startCommand = 'opencode --prompt "complete the current task and move it into in review"';
  useAppStore.setState({ health: openCodeOnly, onboardingSoftDismissed: false });
  useProjectStore.setState({
    tasks: [{ taskNumber: 1, status: 'todo' } as TaskWithWorkspace],
    hooks: {},
    configProjectPath: '/project',
  });
  vi.mocked(window.api.globalSettings.get).mockResolvedValueOnce(
    JSON.stringify({
      version: 1,
      firstProjectPath: '/project',
      source: 'added',
      seededTaskNumber: 1,
      dismissed: false,
    }),
  );

  render(<OnboardingPanel projectPath="/project" onConfigureCliAgent={vi.fn()} onOpenHelp={vi.fn()} />);
  expect(await screen.findByText(startCommand)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
  await waitFor(() => {
    expect(window.api.hooks.save).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({ type: 'start', command: startCommand }),
    );
  });

  cleanup();
  render(<CombinedHookConfigDialog projectPath="/project" onClose={vi.fn()} />);
  expect(screen.getByLabelText('Start').getAttribute('placeholder')).toBe(startCommand);
  expect(screen.getByLabelText('Continue').getAttribute('placeholder')).toBe('opencode -c');

  cleanup();
  render(<HookConfigDialog projectPath="/project" hookType="review" onClose={vi.fn()} />);
  expect(screen.getByLabelText('Command').getAttribute('placeholder')).toBe(
    'opencode --prompt "open a pull request for the current task"',
  );

  cleanup();
  useAppStore.setState({ health: { ...openCodeOnly, codex: true } });
  render(<CombinedHookConfigDialog projectPath="/project" onClose={vi.fn()} />);
  expect(screen.getByLabelText('Continue').getAttribute('placeholder')).toBe('opencode -c');

  cleanup();
  useAppStore.setState({ health: { ...openCodeOnly, claude: true } });
  render(<CombinedHookConfigDialog projectPath="/project" onClose={vi.fn()} />);
  expect(screen.getByLabelText('Continue').getAttribute('placeholder')).toBe('claude -c');
});
