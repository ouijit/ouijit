import { describe, test, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddPanelMenu } from '../../components/terminal/AddPanelMenu';
import { useProjectStore } from '../../stores/projectStore';
import type { RunnerScript, Script } from '../../types';

vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map(),
}));

const PROJECT = '/tmp/project';

/** Unmounts the menu on close, as TerminalHeader does. */
function Host({ onAddRunner }: { onAddRunner: (script?: RunnerScript) => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return <div>closed</div>;
  return (
    <AddPanelMenu
      ptyId="pty-1"
      projectPath={PROJECT}
      x={0}
      y={0}
      onAddRunner={onAddRunner}
      onAddWebPreview={vi.fn()}
      onAddPlan={vi.fn()}
      onClose={() => setOpen(false)}
    />
  );
}

describe('AddPanelMenu', () => {
  test('with no commands, still offers a new script and opens the run command dialog', async () => {
    useProjectStore.setState({ configuredHooks: {}, scripts: [] });
    const onAddRunner = vi.fn();
    render(<Host onAddRunner={onAddRunner} />);

    expect(screen.getByText('New script…')).toBeTruthy();
    fireEvent.click(screen.getByText('Configure run command…'));
    expect(await screen.findByText("Runs from a terminal's + menu")).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    await screen.findByText('closed');
    expect(onAddRunner).not.toHaveBeenCalled();
  });

  test('a new script is saved and run, alongside the existing commands', async () => {
    const existing: Script = { id: 's1', name: 'Lint', command: 'npm run lint', sortOrder: 0, restartIfRunning: false };
    useProjectStore.setState({ configuredHooks: { run: true }, scripts: [existing] });
    const onAddRunner = vi.fn();
    render(<Host onAddRunner={onAddRunner} />);

    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.getByText('Lint')).toBeTruthy();
    expect(screen.queryByText('Configure run command…')).toBeNull();

    const saved: Script = { id: 's2', name: 'Test', command: 'npm test', sortOrder: 1, restartIfRunning: false };
    vi.mocked(window.api.scripts.save).mockResolvedValueOnce({ success: true, script: saved });

    fireEvent.click(screen.getByText('New script…'));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npm test' } });
    fireEvent.click(screen.getByText('Save'));

    await screen.findByText('closed');
    expect(window.api.scripts.save).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ name: 'Test', command: 'npm test' }),
    );
    expect(onAddRunner).toHaveBeenCalledWith(saved);
  });
});
