import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { LensList } from '../../components/scripts/LensList';
import { useExperimentalStore } from '../../stores/experimentalStore';
import { DEFAULT_EXPERIMENTAL_FLAGS } from '../../experimentalFlags';
import { aLens } from '../lensFixtures';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const PROJECT = '/work/alpha';
const NARRATIVE = aLens('Narrative');
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
    // As main answers it: an id naming a lens edits that one, anything else is
    // new and gets an id of its own.
    vi.mocked(window.api.lens.save).mockImplementation(async (_project, input) =>
      input.id === NARRATIVE.id
        ? { ...NARRATIVE, name: input.name, instruction: input.instruction }
        : aLens(input.name, input.instruction),
    );
    vi.mocked(window.api.lens.agent).mockResolvedValue(null);
    window.api.health.check = vi.fn().mockResolvedValue({ claude: true, codex: false });
  });

  test('a project with no lenses is offered four, and pressing one fills the form in', async () => {
    render(<LensList projectPath={PROJECT} />);

    expect(await screen.findByText('No lenses yet.')).toBeTruthy();
    for (const name of ['By layer', 'Risk first', 'Setup and payoff', 'Read then skim']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(window.api.lens.save).not.toHaveBeenCalled();

    const pill = screen.getByText('Setup and payoff');
    expect(pill.getAttribute('title')).toBe(SETUP);
    fireEvent.click(pill);

    expect(screen.getByDisplayValue('Setup and payoff')).toBeTruthy();
    expect(screen.getByDisplayValue(SETUP)).toBeTruthy();
    expect(window.api.lens.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(window.api.lens.save).toHaveBeenCalledWith(PROJECT, { name: 'Setup and payoff', instruction: SETUP }),
    );

    // Gone once there is a list of your own.
    cleanup();
    vi.mocked(window.api.lens.list).mockResolvedValue([NARRATIVE]);
    render(<LensList projectPath={PROJECT} />);
    expect(await screen.findByText('Narrative')).toBeTruthy();
    expect(screen.queryByText('No lenses yet.')).toBeNull();
    expect(screen.queryByText('By layer')).toBeNull();
  });

  test('running is always its own named button, beside saving and beside editing', async () => {
    const run = vi.fn();
    vi.mocked(window.api.lens.list).mockResolvedValue([]);
    render(<LensList projectPath={PROJECT} onRun={run} />);

    fireEvent.click(await screen.findByText('Add a lens'));
    fireEvent.change(screen.getByPlaceholderText('By layer'), { target: { value: 'Narrative' } });
    fireEvent.change(screen.getByPlaceholderText(/One part per layer/), { target: { value: 'group by story' } });
    fireEvent.click(screen.getByText('Save and run'));

    // Handed back as saved, with the id a run needs.
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ name: 'Narrative', instruction: 'group by story' })),
    );

    cleanup();
    run.mockClear();
    vi.mocked(window.api.lens.save).mockClear();
    vi.mocked(window.api.lens.list).mockResolvedValue([NARRATIVE]);
    render(<LensList projectPath={PROJECT} onRun={run} />);

    fireEvent.click(await screen.findByLabelText('Run “Narrative”'));
    expect(run).toHaveBeenCalledWith(NARRATIVE);
    expect(window.api.lens.save).not.toHaveBeenCalled();

    run.mockClear();
    fireEvent.click(screen.getByLabelText('Edit “Narrative”'));
    fireEvent.change(screen.getByDisplayValue('group by story'), { target: { value: 'group by risk' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.lens.save).toHaveBeenCalledWith(PROJECT, {
        id: NARRATIVE.id,
        name: 'Narrative',
        instruction: 'group by risk',
      }),
    );
    expect(run).not.toHaveBeenCalled();
  });

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
