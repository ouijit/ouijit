import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { IconColorSection } from '../../components/scripts/IconColorSection';
import { useAppStore } from '../../stores/appStore';
import { stringToColor } from '../../utils/projectIcon';
import type { Project } from '../../types';

function seedProject(overrides: Partial<Project> = {}): Project {
  const project: Project = {
    name: 'My App',
    path: '/projects/app',
    hasGit: true,
    hasClaude: false,
    lastModified: new Date(0),
    ...overrides,
  };
  useAppStore.getState().setProjects([project]);
  return project;
}

describe('IconColorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setProjects([]);
    vi.mocked(window.api.refreshProjects).mockResolvedValue([]);
  });

  test('renders nothing when the project is unknown', () => {
    const { container } = render(<IconColorSection projectPath="/projects/missing" />);
    expect(container.firstChild).toBeNull();
  });

  test('shows the generated color when no override is set', () => {
    seedProject();
    const { container } = render(<IconColorSection projectPath="/projects/app" />);
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(input.value).toBe(stringToColor('My App').toLowerCase());
  });

  test('shows the custom color when one is set', () => {
    seedProject({ iconColor: '#123456' });
    const { container } = render(<IconColorSection projectPath="/projects/app" />);
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(input.value).toBe('#123456');
  });

  test('picking a color persists it (debounced) and refreshes projects', async () => {
    seedProject();
    const { container } = render(<IconColorSection projectPath="/projects/app" />);
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '#abcdef' } });

    await waitFor(() => {
      expect(window.api.setProjectIconColor).toHaveBeenCalledWith('/projects/app', '#abcdef');
    });
    expect(window.api.refreshProjects).toHaveBeenCalled();
  });

  test('no Automatic button until a custom color is set', () => {
    seedProject();
    const { queryByText } = render(<IconColorSection projectPath="/projects/app" />);
    expect(queryByText('Automatic')).toBeNull();
  });

  test('the Automatic button reverts to the generated color', async () => {
    seedProject({ iconColor: '#123456' });
    const { getByText } = render(<IconColorSection projectPath="/projects/app" />);

    fireEvent.click(getByText('Automatic'));

    await waitFor(() => {
      expect(window.api.setProjectIconColor).toHaveBeenCalledWith('/projects/app', null);
    });
  });
});
