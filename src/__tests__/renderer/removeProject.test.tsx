import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { RemoveProjectRow } from '../../components/scripts/RemoveProjectRow';
import { useAppStore } from '../../stores/appStore';

describe('removing a project from its settings', () => {
  test('asks once more, and on yes removes it and leaves its settings', async () => {
    useAppStore.getState().select({ kind: 'page', projectPath: '/p', page: 'settings' });
    vi.mocked(window.api.refreshProjects).mockResolvedValue([]);
    render(<RemoveProjectRow projectPath="/p" />);

    fireEvent.click(screen.getByText('Remove…'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(window.api.removeProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Remove…'));
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(useAppStore.getState().selection).toEqual({ kind: 'none' }));
    expect(window.api.removeProject).toHaveBeenCalledWith('/p');
  });
});
