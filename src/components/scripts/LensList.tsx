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
   * Reads a change through a lens — one from the list, or one just saved.
   * Absent in settings, where there is no diff to read one against.
   *
   * Where it is given, every row carries Run and every form offers to save and
   * run. Those are the only things here that spend a run, and each says so.
   */
  onRun?: (lens: LensSummary) => void;
  /** Id of the lens currently being written, if any. */
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
/**
 * Where a project's first lens comes from.
 *
 * The instruction is the whole feature, and a blank prose box under a label
 * teaches nothing about what belongs in one. These four ask different questions
 * rather than sorting the same way four times — by structure, by judgement, by
 * the shape of the change, and by how much attention each part is worth.
 *
 * Each one has to give the agent a test it can apply to any diff. "The riskiest
 * changes first" names a sort key and never says how to compute it, which on a
 * change with no obvious risk leaves it to invent one. What belongs in every
 * lens rather than this one — leading with what the rest follows from, keeping
 * mechanical churn last, how a title is written — is in the prompt itself.
 *
 * Offered rather than seeded. Writing them into the project on first open would
 * give everyone four lenses they did not write and have to delete — and
 * pressing one fills the form in rather than saving, so what is being added is
 * read before it is kept.
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
  const { lenses, reload } = useProjectLenses(projectPath);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The new lens being written, filled in from a suggestion or blank. */
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
      await reload();
      setExpandedId(null);
      setAddingNew(false);
      setDraft(null);
      if (run) onRun?.(saved);
    },
    [projectPath, reload, onRun],
  );

  const remove = useCallback(
    async (lens: LensSummary) => {
      await window.api.lens.delete(projectPath, lens.id);
      await reload();
      setExpandedId(null);
      useProjectStore.getState().addToast(`Deleted “${lens.name}”`, 'success');
    },
    [projectPath, reload],
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

/**
 * One lens, given room to be read.
 *
 * The name and the command are two different things and get two lines. Sharing
 * one, as the script rows do, left a truncated prompt fighting a truncated name
 * for the same width — and a lens command is a sentence, not a binary name.
 */
function LensRow({
  lens,
  onEdit,
  onRun,
  writing,
  busy,
}: {
  lens: LensSummary;
  onEdit: () => void;
  /** Offered where there is a diff to read. Absent in settings. */
  onRun?: () => void;
  writing: boolean;
  /** A run is already in flight, and there is one at a time. */
  busy: boolean;
}) {
  return (
    // Nothing about the row is pressable except the two buttons, and both say
    // what they are. Running costs an agent and editing does not, so a press
    // that could be either is a press nobody can make on purpose.
    //
    // No glyph at the head of the line, the same as the picker's rows: an
    // aperture beside every entry of a list of lenses, under a heading that
    // says Lenses beside one, is a word repeated until it stops being read.
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-text-primary truncate">{lens.name}</span>
        <span className={`block text-[11px] font-mono truncate ${writing ? 'text-accent' : 'text-text-tertiary'}`}>
          {writing ? 'Writing…' : lens.instruction}
        </span>
      </span>

      {/* Standing, not waiting for a hover. How to read a change through a lens
          you already have is the question this list is opened with. */}
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
  /**
   * Offered where there is a diff to read. Beside saving rather than instead of
   * it: wanting to keep a lens and wanting to spend a run on it now are two
   * different wants, and a form that only offers the second answers neither.
   */
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
  // screen and two identical rows say nothing. Said before the save, not after.
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
      // Saves and stops, where a shortcut usually takes the primary button.
      // The other one spends an agent run, which nothing should do because a
      // key was held down over a text box.
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
        {/* Prose, not a command. The title, the description and the diff are
            put in front of the agent by Ouijit; this is the only part that is
            the reader's to say.

            The placeholder is one sample instruction and nothing else — what
            the field is for is the label's job, and what is sent with it is
            the line underneath. An instruction written in here reads as a
            value already filled in.

            It names the same lens the field above does. Two placeholders
            describing different lenses is an example that teaches nothing. */}
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
        {/* Whichever of the two is on the right is the one being urged. Where
            there is a diff to read, that is the run — but keeping the lens has
            to be a press of its own, not a thing you get to by not running. */}
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
