import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentalStore } from '../../stores/experimentalStore';
import type { LensInput, LensSummary } from '../../lens/config';
import { describeError } from '../../utils/describeError';
import { Icon } from '../terminal/Icon';
import { useAutoResize } from '../../hooks/useAutoResize';
import { useProjectLenses } from '../diff/useProjectLenses';

interface LensListProps {
  projectPath: string;
  /**
   * Reads a change through a lens — one from the list, or one just saved. Absent
   * in settings, where there is no diff to read one against.
   */
  onRun?: (lens: LensSummary) => void;
  running?: string | null;
}

/**
 * Where a project's first lens comes from. Each has to give the agent a test it
 * can apply to any diff: "the riskiest changes first" names a sort key without
 * saying how to compute it, so a change with no obvious risk leaves it to invent
 * one. What belongs in every lens instead — leading with what the rest follows
 * from, mechanical churn last, how a title is written — is in `GROUPING_GUIDE`.
 */
const SUGGESTED_LENSES: LensInput[] = [
  {
    name: 'By layer',
    instruction:
      'One part per layer the change touches, from the data outwards: what stores it, what uses it, what shows it. A file that spans two layers goes in the one it changes most.',
  },
  {
    name: 'Risk first',
    instruction:
      'Lead with what could break in production: contracts, migrations, anything with callers you cannot see from here. Then the parts that follow from it. Anything that can only fail a test goes last.',
  },
  {
    name: 'Setup and payoff',
    instruction:
      'One part for the groundwork that had to land first, one for the change it was laid for. If the groundwork is large, split it by what depends on what.',
  },
  {
    name: 'Read then skim',
    instruction:
      'Split by how much attention each part deserves. Lead with what a reviewer has to read line by line and could reject the change over, then what merely follows from it. Mechanical churn goes last, named so it can be skipped.',
  },
];

export function LensList({ projectPath, onRun, running }: LensListProps) {
  const lenses = useProjectLenses(projectPath);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LensInput | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  // What `buildLensPrompt` will actually carry: the hotspot section is written
  // only when `getDiffSignals` answers, and it answers only with this flag on.
  const sendsHotspots = useExperimentalStore((s) => s.flagsByProject[projectPath]?.analysis ?? false);

  const save = useCallback(
    async (input: LensInput, run: boolean) => {
      let saved: LensSummary;
      try {
        saved = await window.api.lens.save(projectPath, input);
      } catch (error) {
        useProjectStore.getState().addToast(describeError(error), 'error');
        return;
      }
      setExpandedId(null);
      setAddingNew(false);
      setDraft(null);
      if (run) onRun?.(saved);
    },
    [projectPath, onRun],
  );

  const remove = useCallback(
    async (lens: LensSummary) => {
      await window.api.lens.delete(projectPath, lens.id);
      setExpandedId(null);
      useProjectStore.getState().addToast(`Deleted “${lens.name}”`, 'success');
    },
    [projectPath],
  );

  return (
    <div
      className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06]"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      {lenses.length === 0 && !addingNew && (
        <div className="px-4 py-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] text-text-tertiary">No lenses yet.</span>
          {SUGGESTED_LENSES.map((suggested) => (
            <button
              key={suggested.name}
              type="button"
              title={suggested.instruction}
              className="px-2.5 py-1 text-[11px] text-text-secondary bg-ink/[0.05] rounded-full hover:bg-ink/[0.09] hover:text-text-primary transition-colors duration-150"
              onClick={() => {
                setDraft(suggested);
                setAddingNew(true);
              }}
            >
              {suggested.name}
            </button>
          ))}
        </div>
      )}

      {lenses.map((lens) =>
        expandedId === lens.id ? (
          <LensForm
            key={lens.id}
            initial={lens}
            sendsHotspots={sendsHotspots}
            onSave={(next) => void save({ ...next, id: lens.id }, false)}
            onSaveAndRun={onRun && ((next) => void save({ ...next, id: lens.id }, true))}
            onCancel={() => setExpandedId(null)}
            onDelete={() => void remove(lens)}
          />
        ) : (
          <LensRow
            key={lens.id}
            lens={lens}
            onEdit={() => {
              setExpandedId(lens.id);
              setAddingNew(false);
              setDraft(null);
            }}
            onRun={onRun && (() => onRun(lens))}
            writing={running === lens.id}
            busy={Boolean(running)}
          />
        ),
      )}

      {addingNew && (
        <LensForm
          initial={draft ?? undefined}
          existingNames={lenses.map((l) => l.name)}
          sendsHotspots={sendsHotspots}
          onSave={(next) => void save(next, false)}
          onSaveAndRun={onRun && ((next) => void save(next, true))}
          onCancel={() => {
            setAddingNew(false);
            setDraft(null);
          }}
        />
      )}

      {!addingNew && (
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-3 text-xs text-text-tertiary hover:text-text-primary hover:bg-ink/[0.04] transition-colors duration-100"
          onClick={() => {
            setDraft(null);
            setAddingNew(true);
            setExpandedId(null);
          }}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          Add a lens
        </button>
      )}
    </div>
  );
}

function LensRow({
  lens,
  onEdit,
  onRun,
  writing,
  busy,
}: {
  lens: LensSummary;
  onEdit: () => void;
  onRun?: () => void;
  writing: boolean;
  /** A run is already in flight, and there is one at a time. */
  busy: boolean;
}) {
  return (
    // Nothing about the row is pressable except the two buttons: running costs
    // an agent and editing does not, so a press that could be either is a press
    // nobody can make on purpose.
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-text-primary truncate">{lens.name}</span>
        <span className={`block text-[11px] font-mono truncate ${writing ? 'text-accent' : 'text-text-tertiary'}`}>
          {writing ? 'Writing…' : lens.instruction}
        </span>
      </span>

      <button
        type="button"
        aria-label={`Edit “${lens.name}”`}
        className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-text-tertiary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
        onClick={onEdit}
      >
        <Icon name="pencil-simple" className="w-3.5 h-3.5" />
        Edit
      </button>
      {onRun && (
        <button
          type="button"
          aria-label={`Run “${lens.name}”`}
          title={`Read this change through “${lens.name}”`}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent transition-colors duration-150"
          onClick={onRun}
        >
          <Icon name="play" className="w-3.5 h-3.5" />
          Run
        </button>
      )}
    </div>
  );
}

// ── Inline edit form ────────────────────────────────────────────────

const QUIET_BUTTON =
  'px-3 py-1.5 text-xs font-medium rounded-md text-text-secondary hover:bg-ink/[0.06] transition-colors duration-150 disabled:opacity-40';

function primaryButton(isValid: boolean): string {
  return `px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 ${
    isValid ? 'text-accent-ink bg-accent hover:bg-accent-hover' : 'text-text-tertiary bg-background-tertiary'
  }`;
}

function LensForm({
  initial,
  existingNames,
  sendsHotspots,
  onSave,
  onSaveAndRun,
  onCancel,
  onDelete,
}: {
  initial?: LensInput;
  existingNames?: string[];
  /** Whether the prompt will carry the history section as well as the diff. */
  sendsHotspots: boolean;
  onSave: (lens: { name: string; instruction: string }) => void;
  /** Beside saving rather than instead of it. */
  onSaveAndRun?: (lens: { name: string; instruction: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [instruction, setInstruction] = useState(initial?.instruction ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useAutoResize();

  useEffect(() => {
    if (!initial?.name) nameRef.current?.focus();
    // Grown to what is already in it, or an edited lens opens with its command
    // clipped to two lines.
    const box = commandRef.current;
    if (box) {
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight}px`;
    }
  }, [initial]);

  // Nothing breaks if two lenses share a name, but the picker names what is on
  // screen by it. Said before the save rather than after.
  const collides = !initial?.id && existingNames?.includes(name.trim());
  const isValid = Boolean(name.trim()) && Boolean(instruction.trim()) && !collides;

  const submit = useCallback(
    (run: boolean) => {
      if (!name.trim() || !instruction.trim() || collides) return;
      const lens = { name: name.trim(), instruction: instruction.trim() };
      if (run && onSaveAndRun) onSaveAndRun(lens);
      else onSave(lens);
    },
    [name, instruction, collides, onSave, onSaveAndRun],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Saves and stops, where a shortcut usually takes the primary button: the
      // other one spends an agent run, which no held-down key should.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(false);
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
          placeholder="By layer"
        />
        {collides && <div className="mt-1 text-[11px] text-error">A lens called “{name.trim()}” already exists</div>}
      </div>

      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">How to group it</label>
        {/* Prose, not a command: the title, the description and the diff are put
            in front of the agent by Ouijit, and this is the reader's part. */}
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
          placeholder="One part per layer the change touches, from the data outwards: what stores it, what uses it, what shows it."
        />
        <p className="mt-2 text-[11px] text-text-tertiary leading-relaxed">
          {sendsHotspots
            ? 'Ouijit sends the diff, its title, its description, and the hotspots on these files.'
            : 'Ouijit sends the diff, its title, and its description with this.'}
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
        <button className={QUIET_BUTTON} onClick={onCancel}>
          Cancel
        </button>
        <button
          className={onSaveAndRun ? QUIET_BUTTON : primaryButton(isValid)}
          disabled={!isValid}
          onClick={() => submit(false)}
        >
          Save
        </button>
        {onSaveAndRun && (
          <button className={primaryButton(isValid)} disabled={!isValid} onClick={() => submit(true)}>
            Save and run
          </button>
        )}
      </div>
    </div>
  );
}
