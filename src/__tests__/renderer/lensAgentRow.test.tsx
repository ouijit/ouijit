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

/**
 * Both agents come back with the same shape through the same isolation, so who
 * wrote a lens is only a question when there is more than one to ask. The rule
 * this pins is that the row appears exactly when it can be acted on.
 */
describe('which agent writes a lens', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.api.health.check = vi.fn().mockResolvedValue(HEALTH);
    window.api.lens.agent = vi.fn().mockResolvedValue({ agentId: null });
    window.api.lens.setAgent = vi.fn().mockResolvedValue({ success: true });
  });

  test('the control names what will run, and picking one outranks what is merely installed', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);

    // Nobody has chosen, so this is automatic — which is how the answer was
    // arrived at, not the answer. Claude Code is what a run would spawn.
    const control = await screen.findByRole('button', { name: /Claude Code/ });
    expect(screen.queryByRole('button', { name: /Automatic/ })).toBeNull();

    fireEvent.click(control);
    // Offered as a choice, where it is one, and saying what it comes to.
    expect(screen.getByRole('menuitem', { name: /^Automatic/ }).textContent).toContain('Claude Code');
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Codex/ }));

    await waitFor(() => {
      expect(window.api.lens.setAgent).toHaveBeenCalledWith(PROJECT, { agentId: 'codex' });
    });
    // Claude Code is installed and comes first, but a choice was made.
    expect(await screen.findByRole('button', { name: /Codex/ })).toBeTruthy();
  });

  test('one agent is no decision, so nothing is drawn', async () => {
    installed({ codex: false });
    const { container } = render(<LensAgentRow projectPath={PROJECT} />);

    await waitFor(() => expect(window.api.health.check).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  test('with neither installed it says so, rather than offering a choice of nothing', async () => {
    // Said here rather than left for the run to fail with: a lens written
    // against no agent is a form filled in for nobody.
    installed({ claude: false, codex: false });
    render(<LensAgentRow projectPath={PROJECT} />);

    expect(await screen.findByText(/Lenses need Claude Code or Codex installed/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('the flags are not put in front of the reader', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByRole('button', { name: /Claude Code/ });

    // A preset nobody can edit is a command line there is nothing to do with.
    // The runner logs the invocation for anyone who needs it.
    expect(screen.queryByText(/--safe-mode/)).toBeNull();
    expect(screen.queryByText(/claude -p/)).toBeNull();
  });

  /**
   * Pi and opencode run terminals in this app, so a reader could reasonably
   * expect them here. Neither CLI can be held to a JSON schema, and a grouping
   * that is merely hoped for is not one this pane can stand behind.
   */
  test('only the agents that can be held to a schema are offered', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);

    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    await screen.findByRole('menuitem', { name: /^Claude Code/ });

    expect(screen.queryByRole('menuitem', { name: /^Pi/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /opencode/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Custom command/ })).toBeNull();
  });
});
