import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';

interface LensCommandSectionProps {
  projectPath: string;
}

/**
 * The command that writes a pull request's reading order.
 *
 * One per project, and its own setting rather than one of the named pull
 * request commands. Those are things a person chooses to run; this is what the
 * Code pane calls when a reader asks for the change as a story. Reuse lives
 * here, in the prompt — the grouping it produces is specific to one pull
 * request and is never reused.
 */
export function LensCommandSection({ projectPath }: LensCommandSectionProps) {
  const [command, setCommand] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    void window.api.github.lensCommand(projectPath).then((value) => {
      setCommand(value);
      setSaved(value);
    });
  }, [projectPath]);

  const save = useCallback(async () => {
    await window.api.github.setLensCommand(projectPath, command);
    setSaved(command.trim());
    setCommand(command.trim());
    useProjectStore.getState().addToast('Reading-order command saved', 'success');
  }, [projectPath, command]);

  const dirty = command.trim() !== saved;

  return (
    <div
      className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      <div className="px-4 py-3 space-y-3">
        <div>
          <input
            className="w-full px-2.5 py-1.5 text-xs text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors font-mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            placeholder='e.g. claude "group this pull request into a reading order"'
          />
          <p className="mt-1.5 text-[11px] text-text-tertiary leading-snug">
            Runs in a terminal with <span className="font-mono">OUIJIT_PR_NUMBER</span> set, and writes back with{' '}
            <span className="font-mono">ouijit pr lens set</span>. Groups name the parts of the change and point at the
            hunks that make each one up, so the Code pane can be read in the order the change was made rather than the
            order it was stored.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <button
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 ${
              dirty ? 'text-accent-ink bg-accent hover:bg-accent-hover' : 'text-text-tertiary bg-background-tertiary'
            }`}
            disabled={!dirty}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
