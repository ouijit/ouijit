import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { IconColorSection } from '../../components/scripts/IconColorSection';
import { useAppStore } from '../../stores/appStore';
import type { Project } from '../../types';

const PROJECT: Project = {
  name: 'My App',
  path: '/projects/app',
  iconColor: '#123456',
};

describe('IconColorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setProjects([PROJECT]);
    // A refresh keeps the (custom-colored) project mounted between interactions.
    vi.mocked(window.api.refreshProjects).mockResolvedValue([PROJECT]);
  });

  test('picking a color persists it and refreshes; Automatic reverts to null', async () => {
    const { container, getByText } = render(<IconColorSection projectPath="/projects/app" />);
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '#abcdef' } });
    await waitFor(() => {
      expect(window.api.setProjectIconColor).toHaveBeenCalledWith('/projects/app', '#abcdef');
    });
    expect(window.api.refreshProjects).toHaveBeenCalled();

    fireEvent.click(getByText('Automatic'));
    await waitFor(() => {
      expect(window.api.setProjectIconColor).toHaveBeenCalledWith('/projects/app', null);
    });
  });
});
