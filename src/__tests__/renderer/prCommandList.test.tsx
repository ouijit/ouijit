import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { PrCommandList } from '../../components/scripts/PrCommandList';
import { useProjectStore } from '../../stores/projectStore';

const PROJECT = '/work/alpha';

describe('PrCommandList', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useProjectStore.setState({ toasts: [] });
    vi.mocked(window.api.github.listPrCommands).mockResolvedValue([]);
    vi.mocked(window.api.github.savePrCommand).mockResolvedValue({ name: 'Review', command: 'claude review' });
  });

  test('adds a command, and says what an agent can write back', async () => {
    render(<PrCommandList projectPath={PROJECT} />);

    expect(await screen.findByText('No pull request commands yet. Add one below.')).toBeTruthy();

    fireEvent.click(screen.getByText('Add Command'));

    // The form says what this is for: an agent started here files comments and
    // writes a reading order, which is the whole reason to configure one.
    expect(screen.getByText(/ouijit pr draft add/)).toBeTruthy();
    expect(screen.getByText(/ouijit pr lens set/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('e.g. Narrative, Review with Claude'), {
      target: { value: 'Review' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. claude "review this pull request"'), {
      target: { value: 'claude review' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.github.savePrCommand).toHaveBeenCalledWith(PROJECT, 'Review', 'claude review', undefined),
    );
  });

  /**
   * Rows are keyed by name, so a new command taking an existing name would
   * overwrite it. Refused in the form rather than discovered afterwards.
   */
  test('a duplicate name is refused before it can overwrite anything', async () => {
    vi.mocked(window.api.github.listPrCommands).mockResolvedValue([{ name: 'Review', command: 'claude review' }]);

    render(<PrCommandList projectPath={PROJECT} />);
    // Wait for the existing row, or there is nothing to collide with yet.
    await screen.findByText('Review');
    fireEvent.click(screen.getByText('Add Command'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Narrative, Review with Claude'), {
      target: { value: 'Review' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. claude "review this pull request"'), {
      target: { value: 'other' },
    });

    expect(screen.getByText('A command called “Review” already exists')).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));
    expect(window.api.github.savePrCommand).not.toHaveBeenCalled();
  });

  /** Renaming has to carry the old name, or the old row survives as a duplicate. */
  test('renaming passes the previous name so the old row goes', async () => {
    vi.mocked(window.api.github.listPrCommands).mockResolvedValue([{ name: 'Review', command: 'claude review' }]);

    render(<PrCommandList projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Review'));

    fireEvent.change(screen.getByDisplayValue('Review'), { target: { value: 'Deep review' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.github.savePrCommand).toHaveBeenCalledWith(PROJECT, 'Deep review', 'claude review', 'Review'),
    );
  });
});
