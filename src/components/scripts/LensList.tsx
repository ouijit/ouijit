import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useGithubStore } from '../../stores/githubStore';
import type { LensSummary } from '../../lens/config';
import { Icon } from '../terminal/Icon';
import { useAutoResize } from '../../hooks/useAutoResize';
import { LensAgentRow } from './LensAgentRow';
import { useProjectLenses } from '../diff/useProjectLenses';

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
  const { lenses, reload } = useProjectLenses(projectPath);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const save = useCallback(
    async (lens: LensSummary, previousName?: string) => {
      try {
        await window.api.lens.save(projectPath, lens.name, lens.instruction, previousName);
      } catch (error) {
        useProjectStore.getState().addToast(error instanceof Error ? error.message : String(error), 'error');
        return;
      }
      // A pull request being read through this one should say what it is called
      // now, rather than waiting to be reopened to find out.
      if (previousName && previousName !== lens.name) {
        useGithubStore.getState().renameLensName(previousName, lens.name);
      }
      await reload();
      setExpandedName(null);
      setAddingNew(false);
    },
    [projectPath, reload],
  );

  const remove = useCallback(
    async (name: string) => {
      await window.api.lens.delete(projectPath, name);
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
      {/* Above the lenses because it is true of all of them: a lens is a
          prompt, and this is who gets asked. */}
      <LensAgentRow projectPath={projectPath} />

      {lenses.length === 0 && !addingNew && (
        <div className="px-4 py-8 text-center text-xs text-text-tertiary">
          No lenses yet — add one below and it will be here for every pull request.
        </div>
      )}

      {lenses.map((lens) =>
        expandedName === lens.name ? (
          <LensForm
            key={lens.name}
            initial={lens}
            onSave={(next) => void save(next, lens.name)}
            onCancel={() => setExpandedName(null)}
            onDelete={() => void remove(lens.name)}
          />
        ) : (
          <LensRow
            key={lens.name}
            lens={lens}
            // In the dialog the row is the lens: pressing it reads the pull
            // request through it. In settings there is nothing to read, so the
            // row opens itself for editing instead.
            onPress={() => (onRun ? onRun(lens) : setExpandedName(lens.name))}
            onEdit={() => {
              setExpandedName(lens.name);
              setAddingNew(false);
            }}
            writing={running === lens.name}
            busy={Boolean(running)}
          />
        ),
      )}

      {addingNew && (
        <LensForm
          existingNames={lenses.map((l) => l.name)}
          onSave={(next) => void save(next)}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {!addingNew && (
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-3 text-xs text-text-tertiary hover:text-text-primary hover:bg-ink/[0.04] transition-colors duration-100"
          onClick={() => {
            setAddingNew(true);
            setExpandedName(null);
          }}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          Add a lens
        </button>
      )}
    </div>
  );
}

/**
 * One lens, given room to be read.
 *
 * The name and the command are two different things and get two lines. Sharing
 * one, as the script rows do, left a truncated prompt fighting a truncated name
 * for the same width — and a lens command is a sentence, not a binary name.
 */
function LensRow({
  lens,
  onPress,
  onEdit,
  writing,
  busy,
}: {
  lens: LensSummary;
  onPress: () => void;
  onEdit: () => void;
  writing: boolean;
  busy: boolean;
}) {
  return (
    <div className="group/lens flex items-center gap-3 pl-4 pr-2">
      <button
        type="button"
        className="flex-1 min-w-0 flex items-center gap-3 py-3 text-left disabled:opacity-50"
        disabled={busy}
        onClick={onPress}
      >
        <Icon name="aperture" className={`shrink-0 w-4 h-4 ${writing ? 'text-accent' : 'text-accent/60'}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-text-primary truncate">{lens.name}</span>
          <span className="block text-[11px] text-text-tertiary font-mono truncate">
            {writing ? 'Writing…' : lens.instruction}
          </span>
        </span>
      </button>

      <button
        type="button"
        title={`Edit ${lens.name}`}
        aria-label={`Edit ${lens.name}`}
        className="shrink-0 w-7 h-7 rounded-md text-text-tertiary flex items-center justify-center opacity-0 group-hover/lens:opacity-100 focus-visible:opacity-100 hover:bg-ink/[0.08] hover:text-text-primary transition-all duration-150"
        onClick={onEdit}
      >
        <Icon name="pencil-simple" className="w-4 h-4" />
      </button>
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
  const [instruction, setInstruction] = useState(initial?.instruction ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useAutoResize();

  useEffect(() => {
    if (!initial) nameRef.current?.focus();
    // Grown to what is already in it, or an edited lens opens with its command
    // clipped to two lines.
    const box = commandRef.current;
    if (box) {
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight}px`;
    }
  }, [initial]);

  // Names are the key, so a new one colliding would silently overwrite the
  // lens already using it. Said before the save, not after.
  const collides = !initial && existingNames?.includes(name.trim());
  const isValid = Boolean(name.trim()) && Boolean(instruction.trim()) && !collides;

  const submit = useCallback(() => {
    if (!name.trim() || !instruction.trim() || collides) return;
    onSave({ name: name.trim(), instruction: instruction.trim() });
  }, [name, instruction, collides, onSave]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
      if (e.key === 'Escape') onCancel();
    },
    [submit, onCancel],
  );

  return (
    <div className="px-4 py-4 space-y-4 bg-ink/[0.03]" onClick={(e) => e.stopPropagation()}>
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
        <label className="block text-[11px] text-text-tertiary mb-1">How to group it</label>
        {/* Prose, not a command. The title, the description and the diff are
            put in front of the agent by Ouijit; this is the only part that is
            the reader's to say. */}
        <textarea
          ref={commandRef}
          rows={3}
          className="w-full px-2.5 py-2 text-xs text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors resize-none leading-relaxed"
          value={instruction}
          onChange={(e) => {
            setInstruction(e.target.value);
            autoResize(e);
          }}
          onInput={autoResize}
          onKeyDown={onKeyDown}
          placeholder="Group by the parts of the change and order them so each one makes sense given the last — data model first, then the code that uses it, then the UI."
        />
        <p className="mt-2 text-[11px] text-text-tertiary leading-relaxed">
          The pull request&rsquo;s title, description and full diff are sent with this. Say how you want it organised —
          nothing about where to find it.
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
