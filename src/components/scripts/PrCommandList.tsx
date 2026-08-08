import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { PrCommandSummary } from '../../github/service';
import type { PrCommandMode } from '../../db';
import { Icon } from '../terminal/Icon';
import { ScriptRowView } from './ScriptRowView';

interface PrCommandListProps {
  projectPath: string;
}

const MODES: Array<{ value: PrCommandMode; label: string; hint: string }> = [
  {
    value: 'lens',
    label: 'Lens',
    hint: 'Reads the changed files on stdin and prints {"groups":[{"title","paths"}]}. Reorders the diff in the Code pane; files it leaves out still show, in a trailing group.',
  },
  {
    value: 'terminal',
    label: 'Terminal',
    hint: 'Opens a terminal running this command, in the pull request’s worktree when it has one. Reachable from Run in the pull request’s action bar.',
  },
];

/**
 * Pull request commands, as rows you can add and edit.
 *
 * These were CLI-only to begin with, which meant the only people who found
 * them were the ones already told they existed. Configuring them belongs
 * wherever hooks and run commands are configured; the CLI still does the same
 * job for anything scripted.
 */
export function PrCommandList({ projectPath }: PrCommandListProps) {
  // Local rather than from the github store: that store's loaders are guarded
  // against the pull request panel's active project, which settings never sets,
  // so reading it here would render an empty list forever. Settings is its own
  // surface with its own lifetime; the panel reloads its copy when it mounts.
  const [commands, setCommands] = useState<PrCommandSummary[]>([]);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const reload = useCallback(async () => {
    setCommands(await window.api.github.listPrCommands(projectPath));
  }, [projectPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (command: PrCommandSummary, previousName?: string) => {
      try {
        await window.api.github.savePrCommand(projectPath, command.name, command.command, command.mode, previousName);
      } catch (error) {
        useProjectStore.getState().addToast(error instanceof Error ? error.message : String(error), 'error');
        return;
      }
      await reload();
      setExpandedName(null);
      setAddingNew(false);
    },
    [projectPath, reload],
  );

  const remove = useCallback(
    async (name: string) => {
      await window.api.github.deletePrCommand(projectPath, name);
      await reload();
      setExpandedName(null);
      useProjectStore.getState().addToast(`Deleted “${name}”`, 'success');
    },
    [projectPath, reload],
  );

  return (
    <div>
      <div
        className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06]"
        style={{ background: 'var(--color-terminal-bg)' }}
      >
        {commands.length === 0 && !addingNew && (
          <div className="px-4 py-6 text-center text-xs text-text-tertiary">
            No pull request commands yet. Add one below.
          </div>
        )}

        {commands.map((command) => (
          <div key={command.name}>
            <ScriptRowView
              name={`${command.name}  ·  ${command.mode}`}
              command={command.command}
              expanded={expandedName === command.name}
              onClick={() => {
                setExpandedName((prev) => (prev === command.name ? null : command.name));
                setAddingNew(false);
              }}
            />
            {expandedName === command.name && (
              <PrCommandForm
                initial={command}
                onSave={(next) => void save(next, command.name)}
                onCancel={() => setExpandedName(null)}
                onDelete={() => void remove(command.name)}
              />
            )}
          </div>
        ))}

        {addingNew && (
          <PrCommandForm
            existingNames={commands.map((c) => c.name)}
            onSave={(next) => void save(next)}
            onCancel={() => setAddingNew(false)}
          />
        )}

        {!addingNew && (
          <div
            className="px-3 py-2 hover:bg-ink/[0.04] transition-colors duration-100"
            onClick={() => {
              setAddingNew(true);
              setExpandedName(null);
            }}
          >
            <span className="flex items-center gap-2 text-xs text-text-tertiary hover:text-text-primary transition-colors duration-150">
              <Icon name="plus" className="w-3.5 h-3.5" />
              Add Command
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline edit form ────────────────────────────────────────────────

function PrCommandForm({
  initial,
  existingNames,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: PrCommandSummary;
  existingNames?: string[];
  onSave: (command: PrCommandSummary) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [mode, setMode] = useState<PrCommandMode>(initial?.mode ?? 'lens');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initial) nameRef.current?.focus();
  }, [initial]);

  // Names are the key, so a new one colliding would silently overwrite the
  // command already using it. Said before the save, not after.
  const collides = !initial && existingNames?.includes(name.trim());
  const isValid = Boolean(name.trim()) && Boolean(command.trim()) && !collides;

  const submit = useCallback(() => {
    if (!name.trim() || !command.trim() || collides) return;
    onSave({ name: name.trim(), command: command.trim(), mode });
  }, [name, command, mode, collides, onSave]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
      if (e.key === 'Escape') onCancel();
    },
    [submit, onCancel],
  );

  return (
    <div className="px-4 py-3 space-y-3" onClick={(e) => e.stopPropagation()}>
      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Name</label>
        <input
          ref={nameRef}
          className="w-full px-2.5 py-1.5 text-xs text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. Narrative, Review with Claude"
        />
        {collides && <div className="mt-1 text-[11px] text-error">A command called “{name.trim()}” already exists</div>}
      </div>

      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Mode</label>
        <div className="flex gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              title={m.hint}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors duration-150 ${
                mode === m.value
                  ? 'text-accent-ink bg-accent border-accent'
                  : 'text-text-secondary bg-transparent border-border hover:bg-background-tertiary'
              }`}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-text-tertiary leading-snug">
          {MODES.find((m) => m.value === mode)?.hint}
        </p>
      </div>

      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Command</label>
        <input
          className="w-full px-2.5 py-1.5 text-xs text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors font-mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={mode === 'lens' ? 'e.g. ./scripts/review-order.sh' : 'e.g. claude "review this pull request"'}
        />
        <p className="mt-1.5 text-[11px] text-text-tertiary leading-snug">
          Runs with <span className="font-mono">OUIJIT_PR_NUMBER</span>,{' '}
          <span className="font-mono">OUIJIT_PR_BRANCH</span>, <span className="font-mono">OUIJIT_PR_URL</span> and{' '}
          <span className="font-mono">OUIJIT_PR_TITLE</span> set.
        </p>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {onDelete && (
          <button
            className="px-3 py-1.5 text-xs text-ansi-red bg-transparent border border-ansi-red/30 rounded-md hover:bg-ansi-red/10 transition-colors duration-150"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
        <div className="flex-1" />
        <button
          className="px-3 py-1.5 text-xs text-text-secondary bg-transparent border border-border rounded-md hover:bg-background-tertiary transition-colors duration-150"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 ${
            isValid ? 'text-accent-ink bg-accent hover:bg-accent-hover' : 'text-text-tertiary bg-background-tertiary'
          }`}
          disabled={!isValid}
          onClick={submit}
        >
          Save
        </button>
      </div>
    </div>
  );
}
