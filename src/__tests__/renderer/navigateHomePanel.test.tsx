import { describe, test, expect } from 'vitest';
import { useAppStore } from '../../stores/appStore';

describe('navigateHome panel option', () => {
  // Guards the `options?.panel ?? 'home'` default: every existing navigateHome
  // caller relies on landing back on the home panel, not settings.
  test('navigateHome() defaults back to the home panel', () => {
    useAppStore.setState({ homeActivePanel: 'settings' });
    useAppStore.getState().navigateHome();
    expect(useAppStore.getState().homeActivePanel).toBe('home');
  });
});
