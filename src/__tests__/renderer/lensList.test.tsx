import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { LensList } from '../../components/scripts/LensList';
import { useExperimentalStore } from '../../stores/experimentalStore';
import { DEFAULT_EXPERIMENTAL_FLAGS } from '../../experimentalFlags';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const PROJECT = '/work/alpha';
const SETUP =
  'One part for the groundwork that had to land first, one for the change it was laid for. If the groundwork is large, split it by what depends on what.';

function analysis(on: boolean) {
  useExperimentalStore.setState({
    flagsByProject: { [PROJECT]: { ...DEFAULT_EXPERIMENTAL_FLAGS, analysis: on } },
  });
}

describe('LensList', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    analysis(false);
    vi.mocked(window.api.lens.list).mockResolvedValue([]);
    vi.mocked(window.api.lens.save).mockImplementation(async (_project, input) => ({
      id: input.id ?? 'made',
      ...input,
    }));
    vi.mocked(window.api.lens.agent).mockResolvedValue({ agentId: null });
    window.api.health.check = vi.fn().mockResolvedValue({ claude: true, codex: false });
  });

  /**
   * The instruction is the whole feature, so a project with no lenses is shown
   * four rather than a blank box. They are offered, not seeded: pressing one is
   * what puts it in the project, and it lands as an ordinary lens.
   */
  test('a project with no lenses is offered four, and pressing one adds it as written', async () => {
    render(<LensList projectPath={PROJECT} />);

    expect(await screen.findByText('No lenses yet.')).toBeTruthy();
    for (const name of ['By layer', 'Risk first', 'Setup and payoff', 'Read then skim']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    // Nothing was written by drawing them.
    expect(window.api.lens.save).not.toHaveBeenCalled();

    // The name is all the pill carries; what it will add is on hovering it.
    const pill = screen.getByText('Setup and payoff');
    expect(pill.getAttribute('title')).toBe(SETUP);
    fireEvent.click(pill);

    await waitFor(() =>
      expect(window.api.lens.save).toHaveBeenCalledWith(PROJECT, { name: 'Setup and payoff', instruction: SETUP }),
    );
  });

  /**
   * Where there is a diff to read, making a lens is what reads it — the reason
   * anyone opens this from a diff. Editing one already in the list is not, so
   * it hands nothing back.
   */
  test('a lens made here is handed back to be read; an edited one is not', async () => {
    const created = vi.fn();
    vi.mocked(window.api.lens.list).mockResolvedValue([]);
    render(<LensList projectPath={PROJECT} onRun={vi.fn()} onCreated={created} />);

    fireEvent.click(await screen.findByText('Add a lens'));
    // The button says what it will do, rather than leaving the run to surprise.
    expect(screen.getByText('Save and read')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('By layer'), { target: { value: 'Narrative' } });
    fireEvent.change(screen.getByPlaceholderText(/One part per layer/), { target: { value: 'group by story' } });
    fireEvent.click(screen.getByText('Save and read'));

    // Handed back as saved, with the id a run needs.
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith({ id: 'made', name: 'Narrative', instruction: 'group by story' }),
    );

    cleanup();
    created.mockClear();
    vi.mocked(window.api.lens.list).mockResolvedValue([
      { id: 'narrative', name: 'Narrative', instruction: 'group by story' },
    ]);
    render(<LensList projectPath={PROJECT} onRun={vi.fn()} onCreated={created} />);

    fireEvent.click(await screen.findByLabelText('Edit Narrative'));
    expect(screen.getByText('Save')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('group by story'), { target: { value: 'group by risk' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.lens.save).toHaveBeenCalledWith(PROJECT, {
        id: 'narrative',
        name: 'Narrative',
        instruction: 'group by risk',
      }),
    );
    expect(created).not.toHaveBeenCalled();
  });

  /** A standing list of suggestions under a list you have curated is clutter. */
  test('with a lens of your own the suggestions are gone', async () => {
    vi.mocked(window.api.lens.list).mockResolvedValue([
      { id: 'narrative', name: 'Narrative', instruction: 'group by story' },
    ]);
    render(<LensList projectPath={PROJECT} />);

    expect(await screen.findByText('Narrative')).toBeTruthy();
    expect(screen.queryByText('No lenses yet.')).toBeNull();
    expect(screen.queryByText('By layer')).toBeNull();
  });

  /**
   * The line under the instruction enumerates what the prompt carries, and
   * `buildLensPrompt` writes the history section only where the analysis flag
   * has left signals to write. Saying it unconditionally is a false list.
   */
  test('the hotspots are named only where they are actually sent', async () => {
    render(<LensList projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Add a lens'));
    expect(await screen.findByText(/sends the diff, its title, and its description/)).toBeTruthy();
    expect(screen.queryByText(/hotspots/)).toBeNull();

    cleanup();
    analysis(true);
    render(<LensList projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Add a lens'));
    expect(await screen.findByText(/and the hotspots on these files/)).toBeTruthy();
  });
});
