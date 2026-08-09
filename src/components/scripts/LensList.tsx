import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { LensSummary } from '../../github/service';
import { Icon } from '../terminal/Icon';
import { ScriptRowView } from './ScriptRowView';

interface LensListProps {
  projectPath: string;
  /** Offered per row when there is a pull request to run one against. */
  onRun?: (lens: LensSummary) => void;
  /** Name of the lens currently being written, if any. */
  running?: string | null;
}

/**
 * The lenses a project has, as rows you can add and edit.
 *
 * A lens is a way of reading a pull request: a command that reads the diff and
 * says what the parts of the change are. The prompt is what is worth keeping —
 * one for a refactor, one for a feature, one that goes looking for what the
 * tests miss — while the grouping it writes belongs to a single pull request
 * and is never reused.
 *
 * Rendered both in settings and inside the dialog the Code pane opens, so that
 * adding a lens is possible from the place you wanted one.
 */
export function LensList({ projectPath, onRun, running }: LensListProps) {
  // Local rather than from the github store, for the same reason the pull
  // request command list is: that store's loaders are guarded against the
  // panel's active project, which settings never sets.
  const [lenses, setLenses] = useState<LensSummary[]>([]);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const reload = useCallback(async () => {
    setLenses(await window.api.github.listLenses(projectPath));
  }, [projectPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (lens: LensSummary, previousName?: string) => {
      try {
        await window.api.github.saveLens(projectPath, lens.name, lens.command, previousName);
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
      await window.api.github.deleteLens(projectPath, name);
      await reload();
      setExpandedName(null);
      useProjectStore.getState().addToast(`Deleted “${name}”`, 'success');
    },
    [projectPath, reload],
  );

  return (
    <div
      className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06]"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      {lenses.length === 0 && !addingNew && (
        <div className="px-4 py-6 text-center text-xs text-text-tertiary">No lenses yet. Add one below.</div>
      )}

      {lenses.map((lens) => (
        <div key={lens.name}>
          <div className="flex items-stretch">
            <div className="flex-1 min-w-0">
              <ScriptRowView
                name={lens.name}
                command={lens.command}
                expanded={expandedName === lens.name}
                onClick={() => {
                  setExpandedName((prev) => (prev === lens.name ? null : lens.name));
                  setAddingNew(false);
                }}
              />
            </div>
            {onRun && (
              <button
                type="button"
                className="shrink-0 self-center mr-3 px-2.5 py-1 text-[11px] rounded-md text-text-secondary bg-ink/[0.06] hover:bg-ink/10 hover:text-text-primary transition-colors duration-150 disabled:opacity-50"
                disabled={Boolean(running)}
                onClick={(e) => {
                  e.stopPropagation();
                  onRun(lens);
                }}
              >
                {running === lens.name ? 'Writing…' : 'Write'}
              </button>
            )}
          </div>
          {expandedName === lens.name && (
            <LensForm
              initial={lens}
              onSave={(next) => void save(next, lens.name)}
              onCancel={() => setExpandedName(null)}
              onDelete={() => void remove(lens.name)}
            />
          )}
        </div>
      ))}

      {addingNew && (
        <LensForm
          existingNames={lenses.map((l) => l.name)}
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
            Add Lens
          </span>
        </div>
      )}
    </div>
  );
}

// ── Inline edit form ────────────────────────────────────────────────

function LensForm({
  initial,
  existingNames,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: LensSummary;
  existingNames?: string[];
  onSave: (lens: LensSummary) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initial) nameRef.current?.focus();
  }, [initial]);

  // Names are the key, so a new one colliding would silently overwrite the
  // lens already using it. Said before the save, not after.
  const collides = !initial && existingNames?.includes(name.trim());
  const isValid = Boolean(name.trim()) && Boolean(command.trim()) && !collides;

  const submit = useCallback(() => {
    if (!name.trim() || !command.trim() || collides) return;
    onSave({ name: name.trim(), command: command.trim() });
  }, [name, command, collides, onSave]);

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
          placeholder="e.g. Narrative, What the tests miss"
        />
        {collides && <div className="mt-1 text-[11px] text-error">A lens called “{name.trim()}” already exists</div>}
      </div>

      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Command</label>
        <input
          className="w-full px-2.5 py-1.5 text-xs text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors font-mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='e.g. claude "group this pull request into the parts of the change"'
        />
        <p className="mt-1.5 text-[11px] text-text-tertiary leading-snug">
          Runs in a terminal with <span className="font-mono">OUIJIT_PR_NUMBER</span> set, and writes back with{' '}
          <span className="font-mono">ouijit pr lens set</span>. Groups name the parts of the change and point at the
          hunks that make each one up, so the Code pane can be read in the order the change was made rather than the
          order it was stored.
        </p>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {onDelete && (
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-md text-error hover:bg-error/10 transition-colors duration-150"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
        <div className="flex-1" />
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md text-text-secondary hover:bg-ink/[0.06] transition-colors duration-150"
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
