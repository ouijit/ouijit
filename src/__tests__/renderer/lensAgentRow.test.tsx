import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { LensAgentRow } from '../../components/scripts/LensAgentRow';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const PROJECT = '/work/alpha';

const HEALTH = {
  git: true,
  claude: true,
  codex: true,
  pi: true,
  opencode: true,
  lima: false,
  nono: false,
  gh: true,
  ghVersionOk: true,
};

function installed(over: Partial<typeof HEALTH>) {
  window.api.health.check = vi.fn().mockResolvedValue({ ...HEALTH, ...over });
}

/** The row appears exactly when there is a choice to act on. */
describe('which agent writes a lens', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.api.health.check = vi.fn().mockResolvedValue(HEALTH);
    window.api.lens.agent = vi.fn().mockResolvedValue(null);
    window.api.lens.setAgent = vi.fn().mockResolvedValue({ success: true });
  });

  test('the control names what will run, and picking one outranks what is merely installed', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);

    // Nobody has chosen, and Claude Code is what a run would spawn.
    const control = await screen.findByRole('button', { name: /Claude Code/ });
    expect(screen.queryByRole('button', { name: /Automatic/ })).toBeNull();

    fireEvent.click(control);
    expect(screen.getByRole('menuitem', { name: /^Automatic/ }).textContent).toContain('Claude Code');
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Codex/ }));

    await waitFor(() => {
      expect(window.api.lens.setAgent).toHaveBeenCalledWith(PROJECT, 'codex');
    });
    // Claude Code is installed and comes first, but a choice was made.
    expect(await screen.findByRole('button', { name: /Codex/ })).toBeTruthy();
  });

  test('the row appears exactly where there is a decision to make', async () => {
    // One installed is no decision, so nothing is drawn at all.
    installed({ codex: false });
    const { container } = render(<LensAgentRow projectPath={PROJECT} />);
    await waitFor(() => expect(window.api.health.check).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));

    // Said here rather than left for the run to fail with.
    cleanup();
    installed({ claude: false, codex: false });
    render(<LensAgentRow projectPath={PROJECT} />);
    expect(await screen.findByText(/Lenses need Claude Code or Codex installed/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('only what can be held to a schema is offered, and never its flags', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);

    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    await screen.findByRole('menuitem', { name: /^Claude Code/ });

    expect(screen.queryByRole('menuitem', { name: /^Pi/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /opencode/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Custom command/ })).toBeNull();

    // A preset nobody can edit is a command line there is nothing to do with;
    // the runner logs the invocation for anyone who needs it.
    expect(screen.queryByText(/--safe-mode/)).toBeNull();
    expect(screen.queryByText(/claude -p/)).toBeNull();
  });
});
