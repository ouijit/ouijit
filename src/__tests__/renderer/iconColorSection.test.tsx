import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { IconColorSection } from '../../components/scripts/IconColorSection';
import { useAppStore } from '../../stores/appStore';
import type { Project } from '../../types';

function seedProject(overrides: Partial<Project> = {}): void {
  useAppStore.getState().setProjects([
    {
      name: 'My App',
      path: '/projects/app',
      hasGit: true,
      hasClaude: false,
      lastModified: new Date(0),
      ...overrides,
    },
  ]);
}

describe('IconColorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.api.refreshProjects).mockResolvedValue([]);
  });

  test('picking a color persists it and refreshes the project list', async () => {
    seedProject();
    const { container } = render(<IconColorSection projectPath="/projects/app" />);
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '#abcdef' } });

    await waitFor(() => {
      expect(window.api.setProjectIconColor).toHaveBeenCalledWith('/projects/app', '#abcdef');
    });
    expect(window.api.refreshProjects).toHaveBeenCalled();
  });

  test('Automatic reverts a custom color to null', async () => {
    seedProject({ iconColor: '#123456' });
    const { getByText } = render(<IconColorSection projectPath="/projects/app" />);

    fireEvent.click(getByText('Automatic'));

    await waitFor(() => {
      expect(window.api.setProjectIconColor).toHaveBeenCalledWith('/projects/app', null);
    });
  });
});
