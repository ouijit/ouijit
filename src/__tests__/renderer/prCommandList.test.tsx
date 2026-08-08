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
    vi.mocked(window.api.github.savePrCommand).mockResolvedValue({
      name: 'narrative',
      command: './order.sh',
      mode: 'lens',
    });
  });

  test('adds a lens, and says what a lens is while you are choosing', async () => {
    render(<PrCommandList projectPath={PROJECT} />);

    expect(await screen.findByText('No pull request commands yet. Add one below.')).toBeTruthy();

    fireEvent.click(screen.getByText('Add Command'));

    // Lens is the default, and the form explains it rather than assuming the
    // reader already knows what one does.
    expect(screen.getByText(/Reads the changed files on stdin/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('e.g. Narrative, Review with Claude'), {
      target: { value: 'narrative' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. ./scripts/review-order.sh'), {
      target: { value: './order.sh' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.github.savePrCommand).toHaveBeenCalledWith(
        PROJECT,
        'narrative',
        './order.sh',
        'lens',
        undefined,
      ),
    );
  });

  test('switching to terminal changes what the command field expects', async () => {
    render(<PrCommandList projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Add Command'));

    fireEvent.click(screen.getByText('Terminal'));

    expect(screen.getByPlaceholderText('e.g. claude "review this pull request"')).toBeTruthy();
    expect(screen.getByText(/Opens a terminal running this command/)).toBeTruthy();
  });

  /**
   * Rows are keyed by name, so a new command taking an existing name would
   * overwrite it. Refused in the form rather than discovered afterwards.
   */
  test('a duplicate name is refused before it can overwrite anything', async () => {
    vi.mocked(window.api.github.listPrCommands).mockResolvedValue([
      { name: 'narrative', command: './order.sh', mode: 'lens' },
    ]);

    render(<PrCommandList projectPath={PROJECT} />);
    // Wait for the existing row, or there is nothing to collide with yet.
    await screen.findByText(/narrative/);
    fireEvent.click(screen.getByText('Add Command'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Narrative, Review with Claude'), {
      target: { value: 'narrative' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. ./scripts/review-order.sh'), {
      target: { value: './other.sh' },
    });

    expect(screen.getByText('A command called “narrative” already exists')).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));
    expect(window.api.github.savePrCommand).not.toHaveBeenCalled();
  });

  /** Renaming has to carry the old name, or the old row survives as a duplicate. */
  test('renaming passes the previous name so the old row goes', async () => {
    vi.mocked(window.api.github.listPrCommands).mockResolvedValue([
      { name: 'narrative', command: './order.sh', mode: 'lens' },
    ]);

    render(<PrCommandList projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText(/narrative/));

    fireEvent.change(screen.getByDisplayValue('narrative'), { target: { value: 'reading order' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.github.savePrCommand).toHaveBeenCalledWith(
        PROJECT,
        'reading order',
        './order.sh',
        'lens',
        'narrative',
      ),
    );
  });
});
