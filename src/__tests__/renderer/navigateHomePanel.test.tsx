import { describe, test, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../stores/appStore';
import type { Project } from '../../types';

function makeProject(path: string): Project {
  return {
    path,
    name: path,
    hasGit: true,
    hasClaude: false,
    lastModified: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('navigateHome panel option', () => {
  beforeEach(() => {
    useAppStore.setState({ activeView: 'home', activeProjectPath: null, homeActivePanel: 'home' });
  });

  test('navigateHome({ panel: "settings" }) leaves a project and opens the global settings panel', () => {
    useAppStore.getState().navigateToProject('/a', makeProject('/a'));
    expect(useAppStore.getState().activeView).toBe('project');

    useAppStore.getState().navigateHome({ panel: 'settings' });

    const state = useAppStore.getState();
    expect(state.activeView).toBe('home');
    expect(state.activeProjectPath).toBeNull();
    expect(state.homeActivePanel).toBe('settings');
  });

  test('navigateHome() defaults back to the home panel', () => {
    useAppStore.setState({ homeActivePanel: 'settings' });
    useAppStore.getState().navigateHome();
    expect(useAppStore.getState().homeActivePanel).toBe('home');
  });
});
