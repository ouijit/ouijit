import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { OnboardingPanel } from '../../components/kanban/OnboardingPanel';
import { useAppStore } from '../../stores/appStore';
import type { TaskWithWorkspace } from '../../types';
import { seedProject } from './seedProject';

test('the practice-task intro only appears on a board with no tasks', async () => {
  useAppStore.setState({ onboardingSoftDismissed: false });
  seedProject('/project', { tasks: [], hooks: {} });
  vi.mocked(window.api.globalSettings.get).mockResolvedValue(
    JSON.stringify({
      version: 1,
      firstProjectPath: '/project',
      source: 'added',
      seededTaskNumber: null,
      dismissed: false,
    }),
  );

  render(<OnboardingPanel projectPath="/project" onConfigureCliAgent={vi.fn()} onOpenHelp={vi.fn()} />);
  expect(await screen.findByRole('button', { name: /Try a practice task/ })).toBeTruthy();

  seedProject('/project', { tasks: [{ taskNumber: 7, status: 'in_review' } as TaskWithWorkspace] });
  await waitFor(() => expect(screen.queryByRole('button', { name: /Try a practice task/ })).toBeNull());
});
