import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CombinedHookConfigDialog } from '../../components/dialogs/CombinedHookConfigDialog';
import { HookConfigDialog } from '../../components/dialogs/HookConfigDialog';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { getProjectConfig, useProjectDataStore } from '../../stores/projectDataStore';

afterEach(() => {
  cleanup();
  useHomeChatStore.setState({ enabled: false, taskSurface: 'terminal' });
});

test('where tasks open in chat, the start hook dialog edits Setup and First message instead, saved apart from the hooks, and continue stays a command', async () => {
  const stored: Record<string, string> = {
    'chat:taskStart:/project': JSON.stringify({ setup: 'npm install' }),
  };
  vi.mocked(window.api.globalSettings.get).mockImplementation(async (key) => stored[key]);
  vi.mocked(window.api.globalSettings.set).mockImplementation(async (key, value) => {
    stored[key] = value;
    return { success: true };
  });
  useProjectDataStore.setState({ configByProject: {} });
  useHomeChatStore.setState({ enabled: true, taskSurface: 'chat' });

  render(<CombinedHookConfigDialog projectPath="/project" onClose={vi.fn()} />);
  await waitFor(() => expect((screen.getByLabelText('Setup') as HTMLTextAreaElement).value).toBe('npm install'));
  expect(screen.queryByLabelText('Start')).toBeNull();
  const message = screen.getByLabelText('First message') as HTMLTextAreaElement;
  expect(message.value).toBe('$OUIJIT_TASK_DESCRIPTION');
  const preview = screen.getByTestId('first-message-preview');
  expect(preview.textContent).toBe('Add a switch to Settings that changes between the light and dark themes.');

  fireEvent.change(message, { target: { value: 'Read PLAN.md, then: $OUIJIT_TASK_NAME' } });
  expect(preview.textContent).toBe('Read PLAN.md, then: Add a dark mode toggle');
  fireEvent.change(message, { target: { value: '' } });
  expect(preview.textContent).toBe('Nothing is sent; the chat waits for you.');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(getProjectConfig('/project')?.chatTaskStart).toEqual({
      setup: 'npm install',
      firstMessage: '',
    }),
  );
  expect(window.api.hooks.save).not.toHaveBeenCalled();
  cleanup();

  // The single start hook dialog opens the same fields; continue only reopens a terminal's agent, so it stays a command.
  render(<HookConfigDialog projectPath="/project" hookType="start" onClose={vi.fn()} />);
  expect((screen.getByLabelText('Setup') as HTMLTextAreaElement).value).toBe('npm install');
  cleanup();
  render(<HookConfigDialog projectPath="/project" hookType="continue" onClose={vi.fn()} />);
  expect(screen.getByLabelText('Command')).toBeTruthy();
  cleanup();
  useHomeChatStore.setState({ taskSurface: 'terminal' });
  render(<HookConfigDialog projectPath="/project" hookType="start" onClose={vi.fn()} />);
  expect(screen.getByLabelText('Command')).toBeTruthy();
  expect(screen.queryByLabelText('First message')).toBeNull();
});
