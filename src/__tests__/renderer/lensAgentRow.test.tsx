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

describe('which agent writes a lens', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.api.health.check = vi.fn().mockResolvedValue(HEALTH);
    window.api.lens.agent = vi.fn().mockResolvedValue({ agentId: null });
    window.api.lens.setAgent = vi.fn().mockResolvedValue({ success: true });
  });

  test('says which command it will run, not just which agent', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);

    // The preset is somebody else's flags; what we do with them is the thing
    // worth showing — including that the repository's own config does not load.
    expect(await screen.findByText(/claude -p --safe-mode/)).toBeTruthy();
    expect(screen.getByText('Automatic')).toBeTruthy();
  });

  test('with nothing installed it says so rather than naming a binary', async () => {
    // Which agent wins when both are installed is `resolveLensAgent`'s, and is
    // settled in lensPrompt.test.ts. What is left here is the one answer it
    // gives that has no command to render.
    installed({ claude: false, codex: false });
    render(<LensAgentRow projectPath={PROJECT} />);

    expect(await screen.findByText(/No supported agent installed/)).toBeTruthy();
  });

  test('picking one stores it, and it outranks what is merely installed', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByText('Automatic');

    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Codex/ }));

    await waitFor(() => {
      expect(window.api.lens.setAgent).toHaveBeenCalledWith(PROJECT, { agentId: 'codex' });
    });
    // Claude Code is installed and comes first, but a choice was made.
    expect(await screen.findByText(/codex exec -/)).toBeTruthy();
  });

  test('an agent that is not here cannot be chosen, but is still listed', async () => {
    installed({ codex: false });
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByText('Automatic');

    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    const row = await screen.findByRole('menuitem', { name: /Codex/ });

    // Named rather than hidden: which of these this machine has is worth
    // knowing here.
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('not installed');
  });

  /**
   * Pi and opencode run terminals in this app, so a reader could reasonably
   * expect them here. Neither CLI can be held to a JSON schema, and a grouping
   * that is merely hoped for is not one this pane can stand behind.
   */
  test('only the agents that can be held to a schema are offered', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByText('Automatic');

    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    await screen.findByRole('menuitem', { name: /^Claude Code/ });

    expect(screen.queryByRole('menuitem', { name: /^Pi/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /opencode/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Custom command/ })).toBeNull();
  });
});
