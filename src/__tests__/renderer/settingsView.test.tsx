import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MainView } from '../../components/MainView';
import { useAppStore } from '../../stores/appStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { getProjectConfig, loadProjectConfig, useProjectDataStore } from '../../stores/projectDataStore';
import { opensAsChat } from '../../services/chatSettings';

vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  resolveTerminalLabel: () => '',
  refreshTerminalsGitStatus: vi.fn(),
  refreshTerminalGitStatus: vi.fn(),
  hydrateTerminalFont: vi.fn(),
  setTerminalFontFamily: vi.fn(),
  setTerminalFontSize: vi.fn(),
}));

const ALPHA = { name: 'alpha', path: '/p/alpha' };
const BETA = { name: 'beta', path: '/p/beta' };

test("is one page: App's sections and a project's, one at a time, and each project chooses how its tasks open", async () => {
  const stored: Record<string, string> = { 'chat:enabled': '1' };
  vi.mocked(window.api.globalSettings.get).mockImplementation(async (key) => stored[key]);
  vi.mocked(window.api.globalSettings.set).mockImplementation(async (key, value) => {
    stored[key] = value;
    return { success: true };
  });
  useHomeChatStore.setState({ enabled: true });
  useProjectDataStore.setState({ configByProject: {} });
  useAppStore.setState({ projects: [ALPHA, BETA] });
  useAppStore.getState().select({ kind: 'page', projectPath: ALPHA.path, page: 'board' });
  useAppStore.getState().select({ kind: 'app-settings' });
  render(<MainView />);
  const nav = screen.getByRole('navigation', { name: 'Settings' });
  const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

  // App opens on General; another App section replaces it rather than following it down the page.
  expect(heading()).toBe('General');
  expect(screen.getByText('Projects folder')).toBeTruthy();
  fireEvent.click(within(nav).getByRole('button', { name: 'Appearance' }));
  expect(heading()).toBe('Appearance');
  expect(screen.queryByText('Projects folder')).toBeNull();
  expect(screen.getByText('Font family')).toBeTruthy();

  // The project side is about the project settings were opened from, and a section of it is that project's page.
  fireEvent.click(within(nav).getByRole('button', { name: 'Tasks' }));
  expect(useAppStore.getState().selection).toEqual({ kind: 'page', projectPath: ALPHA.path, page: 'settings' });
  expect(heading()).toBe('Tasks');
  await loadProjectConfig(ALPHA.path);

  // Opening a task in a terminal runs the start hook; in a chat, the chosen agent with Setup and a first message.
  expect(await screen.findByText('Runs when a task moves to In Progress')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chat', pressed: false }));
  expect(await screen.findByText('First message')).toBeTruthy();
  expect(screen.getByText('Setup')).toBeTruthy();
  expect(screen.queryByText('Runs when a task moves to In Progress')).toBeNull();
  await waitFor(() => expect(getProjectConfig(ALPHA.path)?.taskOpening.surface).toBe('chat'));
  expect(await opensAsChat(ALPHA.path, undefined)).toBe(true);
  expect(await opensAsChat(BETA.path, undefined)).toBe(false);

  // App and the project each have a General; App's is App's.
  const [appGeneral, projectGeneral] = within(nav).getAllByRole('button', { name: 'General' });
  fireEvent.click(projectGeneral);
  expect(screen.getByText('Experimental')).toBeTruthy();
  fireEvent.click(appGeneral);
  expect(useAppStore.getState().selection).toEqual({ kind: 'app-settings' });
  expect(screen.getByText('Projects folder')).toBeTruthy();
});
