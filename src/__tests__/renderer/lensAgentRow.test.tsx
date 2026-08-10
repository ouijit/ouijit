import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { LensAgentRow } from '../../components/scripts/LensAgentRow';

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
    window.api.github.lensAgent = vi.fn().mockResolvedValue({ agentId: null });
    window.api.github.setLensAgent = vi.fn().mockResolvedValue({ success: true });
  });

  test('says which command it will run, not just which agent', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);

    // The preset is somebody else's flags; what we do with them is the thing
    // worth showing.
    expect(await screen.findByText(/claude -p --permission-mode dontAsk/)).toBeTruthy();
    expect(screen.getByText('Automatic')).toBeTruthy();
  });

  test('with Claude Code missing, it falls to the next one installed', async () => {
    installed({ claude: false });
    render(<LensAgentRow projectPath={PROJECT} />);

    expect(await screen.findByText(/codex exec -/)).toBeTruthy();
  });

  test('with nothing installed it says so rather than naming a binary', async () => {
    installed({ claude: false, codex: false, pi: false, opencode: false });
    render(<LensAgentRow projectPath={PROJECT} />);

    expect(await screen.findByText(/No agent installed/)).toBeTruthy();
  });

  test('picking one stores it, and it outranks what is merely installed', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByText('Automatic');

    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Pi/ }));

    await waitFor(() => {
      expect(window.api.github.setLensAgent).toHaveBeenCalledWith(PROJECT, { agentId: 'pi' });
    });
    // Claude Code is installed and comes first, but a choice was made.
    expect(await screen.findByText(/pi -p --no-tools/)).toBeTruthy();
  });

  test('an agent that is not here cannot be chosen, but is still listed', async () => {
    installed({ opencode: false });
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByText('Automatic');

    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    const row = await screen.findByRole('menuitem', { name: /opencode/ });

    // Named rather than hidden: which of the four this machine has is worth
    // knowing here.
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('not installed');
  });

  test('a custom command replaces the preset entirely', async () => {
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByText('Automatic');

    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Custom command/ }));

    const field = screen.getByPlaceholderText('my-agent --one-shot');
    fireEvent.change(field, { target: { value: 'my-agent --one-shot' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => {
      expect(window.api.github.setLensAgent).toHaveBeenCalledWith(PROJECT, {
        agentId: null,
        command: 'my-agent --one-shot',
      });
    });
    expect(await screen.findByText('Custom')).toBeTruthy();
  });

  test('emptying the custom command goes back to the presets', async () => {
    window.api.github.lensAgent = vi.fn().mockResolvedValue({ agentId: null, command: 'my-agent' });
    render(<LensAgentRow projectPath={PROJECT} />);
    await screen.findByText('Custom');

    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Custom command/ }));

    const field = screen.getByPlaceholderText('my-agent --one-shot');
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => {
      expect(window.api.github.setLensAgent).toHaveBeenCalledWith(PROJECT, { agentId: null });
    });
    expect(await screen.findByText(/claude -p/)).toBeTruthy();
  });
});
