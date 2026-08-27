import { useState } from 'react';
import type { LensSummary } from '../../lens/config';
import type { StoredLens } from '../../lens/readLens';
import { lensCoverage, type ResolvedGroup } from '../../lens/lens';
import { LENS_PROMPT_BUDGET } from '../../lens/lensPrompt';
import type { LensRun } from './useLensSession';
import { formatRelativeTime } from '../../utils/formatDate';
import { Icon } from '../terminal/Icon';
import { MenuDivider, MenuItem, MenuPopover } from '../ui/Menu';

interface LensPickerProps {
  /** The lenses the project keeps, in the order it keeps them. */
  lenses: LensSummary[];
  /**
   * The lens this diff has on file, exactly as it was read.
   *
   * Freshness rides with it rather than beside it, because the two diffs
   * disagree about what a lens that has drifted means and a separate flag could
   * only describe one of them. A pull request drops a stale one — its hunks are
   * gone after a force-push — so it arrives named with no groups. A worktree
   * keeps rendering one, so it arrives with both. Either way the row for it
   * offers to write it again, which is the thing two flags could not say.
   */
  onFile: StoredLens | null;
  /**
   * Its groups bound to the diff on screen, which is where what it covers can
   * be counted — the stored groups only say what the agent claimed.
   */
  resolved: ResolvedGroup[] | null;
  /** Whether the lens on file is the one on screen. */
  lensOn: boolean;
  changedFiles: number;
  /** Characters the prompt for this change would run to, estimated. */
  promptChars: number;
  /** Files marked read. A worktree diff has no such mark, and passes nothing. */
  viewed?: number;
  /** The lens being written, if a run is in flight for this pull request. */
  writing: LensRun | null;
  onAllFiles: () => void;
  /** Show the lens already written, without writing it again. */
  onShowLens: () => void;
  onRun: (lens: LensSummary) => void;
  /** Add, edit and delete the project's lenses. */
  onManage: () => void;
}

/** What the control says it will do, which depends on what it is showing. */
function triggerTitle({
  writing,
  showingLens,
  onFile,
  label,
  staleOffered,
  interrupted,
}: {
  writing: LensRun | null;
  showingLens: boolean;
  onFile: StoredLens | null;
  /** What the lens on file is called now, which a rename moves. */
  label: string;
  /** Whether that lens is stale and still there to be run again. */
  staleOffered: boolean;
  /** A run that never finished, from a session that ended before it did. */
  interrupted: StoredLens['running'];
}): string {
  if (writing) return `${writing.name} is running. The lens appears here when it writes one.`;
  if (interrupted) return `How to read this change — “${interrupted.lensName}” did not finish`;
  if (!showingLens) {
    return staleOffered
      ? `How to read this change — “${label}” was written for earlier commits`
      : 'How to read this change';
  }
  if (onFile?.stale) return `Reading this change through “${label}”, written for an earlier version of it`;
  if (onFile?.lensId) return `Reading this change through “${label}”`;
  return 'Reading this change through a lens written for it';
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** Roughly four characters to a token — close enough for a number with a tilde. */
function tokenLabel(chars: number): string {
  const tokens = Math.round(chars / 4);
  return tokens >= 1000 ? `~${Math.round(tokens / 1000)}k tk` : `~${tokens} tk`;
}

interface RowState {
  isApplied: boolean;
  isStale: boolean;
  /** This lens was being written when the session it was running in ended. */
  isInterrupted: boolean;
  writing: LensRun | null;
  parts: number | null;
  /** Changed files the lens on screen claimed none of. */
  ungrouped: number;
  /** The change will not fit one prompt, so some of it goes as line spans. */
  tooBig: boolean;
}

function rowHint(lens: LensSummary, state: RowState): string | undefined {
  const { isApplied, isStale, isInterrupted, writing, parts, ungrouped, tooBig } = state;
  if (writing?.id === lens.id) return 'Writing…';
  if (isInterrupted) return 'did not finish';
  if (isApplied) {
    if (isStale) return `${plural(parts ?? 0, 'part')} · out of date`;
    return ungrouped > 0
      ? `${plural(parts ?? 0, 'part')} · ${plural(ungrouped, 'file')} not grouped`
      : plural(parts ?? 0, 'part');
  }
  if (isStale) return 'out of date';
  // Only where the row is a plain offer to run: what it changes is whether you
  // start one, and the rows above have something more pressing to say.
  return tooBig ? 'too big to send whole' : undefined;
}

function rowTitle(
  lens: LensSummary,
  { isApplied, isStale, isInterrupted }: RowState,
  { since, promptChars, omitted }: { since: string | null; promptChars: number; omitted: number },
): string {
  // What starting this row would cost, wherever starting it is what the row
  // does — which is every row but the one already showing a lens that fits.
  const size = ` — ${tokenLabel(promptChars)}`;

  if (isInterrupted) {
    const started = since ? `Started ${formatRelativeTime(new Date(since))}` : 'Started';
    return `${started} and never finished — read this change through “${lens.name}” again${size}`;
  }
  if (isApplied) {
    if (isStale) return `Written for an earlier version of this change — read it again through “${lens.name}”${size}`;
    return omitted > 0
      ? `${lens.instruction} — ${omitted} hunk${omitted === 1 ? '' : 's'} were too large to quote and were grouped from their line spans`
      : lens.instruction;
  }
  return isStale
    ? `Written for earlier commits — read this change through “${lens.name}” again${size}`
    : `Read this change through “${lens.name}”${size}`;
}

/**
 * How to read the diff, as one choice.
 *
 * All files is a lens like any other — the one that groups nothing and takes
 * the order the diff arrived in — so it sits in the same list rather than in a
 * control of its own. Two controls would say the file list and a lens are
 * different kinds of thing, and hide the rest of the lenses behind one of them.
 *
 * Picking a lens that has not been written for this head writes it: a lens is
 * an agent run, and the reader asking to read this change through one is the
 * only reason to start it.
 */
export function LensPicker({
  lenses,
  onFile,
  resolved,
  lensOn,
  changedFiles,
  promptChars,
  viewed,
  writing,
  onAllFiles,
  onShowLens,
  onRun,
  onManage,
}: LensPickerProps) {
  const [open, setOpen] = useState(false);

  const rendered = onFile?.groups != null;
  // From the binding rather than the stored groups: a part whose files have all
  // moved on drops out, and the count a reader can see is the bound one.
  const coverage = resolved ? lensCoverage(resolved) : null;
  const parts = coverage?.parts ?? onFile?.groups?.length ?? null;
  const tooBig = promptChars > LENS_PROMPT_BUDGET;
  const showingLens = lensOn && rendered;
  // The lens that wrote what is on screen, if the project still has it. Looked
  // up rather than read off the row: the stored name is what it was called when
  // it ran, and a rename since then moves the one below and not that.
  const wrote = onFile?.lensId ? lenses.find((lens) => lens.id === onFile.lensId) : undefined;
  const appliedLabel = wrote?.name ?? onFile?.lensName ?? 'Lens';
  // A lens written by the CLI, or by one since deleted, has no row of its own
  // in the list below — it gets one here so what is on screen can always be
  // named and gone back to.
  const orphan = rendered && !wrote;
  // Marked only where it can be acted on. A stale lens the project no longer
  // has — deleted, or never one of its own — has no row to carry the notice and
  // nothing to offer, so it is left unsaid.
  const staleOffered = Boolean(onFile?.stale && wrote);
  // A run the app was killed out from under. The mark outlives the process that
  // made it, which is the whole of how one is told from a run still going.
  const interrupted = onFile?.running && !onFile.running.live ? onFile.running : null;

  const label = writing ? `Writing ${writing.name}…` : showingLens ? appliedLabel : 'All files';
  const note = showingLens ? `${parts}` : viewed ? `${viewed}/${changedFiles}` : `${changedFiles}`;

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      // Wider than the rail can be dragged narrow, so a lens name has room to
      // be read even when the file list beside it does not.
      className="w-[17rem] max-h-[22rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          title={triggerTitle({ writing, showingLens, onFile, label: appliedLabel, staleOffered, interrupted })}
          // Fills the ledge it is given rather than setting its own height:
          // what it has to be level with sits across the seam, and the two
          // surfaces that draw this put a different thing there.
          className={`w-full h-full shrink-0 flex items-center gap-1.5 pl-3 pr-3 text-[13px] text-left transition-colors duration-150 ease-out hover:bg-ink/5 ${
            open ? 'bg-ink/[0.07] text-ink' : writing ? 'text-ink/45' : 'text-ink/70'
          }`}
          onClick={() => setOpen(!open)}
        >
          <Icon name={showingLens ? 'aperture' : 'tree-structure'} className="shrink-0 w-4 h-4 opacity-70" />
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {/* Something is waiting behind a control nobody has to open. Without
              it, a reader who never opens the picker never learns that the run
              they paid for describes commits that are no longer here. */}
          {(staleOffered || interrupted) && !writing && (
            <span aria-hidden className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />
          )}
          {!writing && <span className="shrink-0 font-mono text-[11px] text-ink/35">{note}</span>}
          {writing ? (
            <Icon
              name="arrows-clockwise"
              className="shrink-0 w-3 h-3 text-accent"
              style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
            />
          ) : (
            <Icon name="caret-down" className="shrink-0 w-3 h-3 text-ink/40" />
          )}
        </button>
      )}
    >
      {/* No glyphs down the rows: what they are is said by the one on the
          control above and by the divider between the file list and the
          lenses, and an aperture beside every line of a menu of lenses is a
          word repeated until it stops being read. */}
      <MenuItem
        label="All files"
        hint={viewed ? `${viewed}/${changedFiles} read` : `${changedFiles}`}
        selected={!showingLens}
        onClick={() => {
          setOpen(false);
          onAllFiles();
        }}
      />

      {/* Only when there is a list to divide off. With no lens written yet the
          menu is two rows, and a rule between them separates nothing. */}
      {(lenses.length > 0 || (orphan && onFile)) && <MenuDivider />}

      {orphan && onFile && (
        <MenuItem
          label={appliedLabel}
          hint={onFile.stale ? `${plural(parts ?? 0, 'part')} · out of date` : plural(parts ?? 0, 'part')}
          selected={showingLens}
          // No offer to write it again: the project has no lens by this name to
          // run. What it can still do is name what is on screen and go back to it.
          title={onFile.stale ? 'Written for an earlier version of this change' : 'Written for this change'}
          onClick={() => {
            setOpen(false);
            onShowLens();
          }}
        />
      )}

      {lenses.map((lens) => {
        const isApplied = rendered && wrote?.id === lens.id;
        // A lens that has drifted is a run to start again, whether or not it is
        // the one on screen. Showing it is not an option that leads anywhere:
        // when it is rendered the reader is already looking at it, and the
        // notice they want acting on is that it describes an older change.
        const isStale = staleOffered && wrote?.id === lens.id;
        const isInterrupted = interrupted?.lensId === lens.id;
        const state = {
          isApplied,
          isStale,
          isInterrupted,
          writing,
          parts,
          ungrouped: coverage?.ungrouped ?? 0,
          tooBig,
        };
        return (
          <MenuItem
            key={lens.id}
            label={lens.name}
            hint={rowHint(lens, state)}
            selected={isApplied && lensOn}
            // One run at a time. The lens already written and still current is
            // a view to switch to rather than a run to start, so it stays live.
            disabled={Boolean(writing) && (isStale || !isApplied)}
            title={rowTitle(lens, state, {
              since: interrupted?.since ?? null,
              promptChars,
              omitted: onFile?.omitted ?? 0,
            })}
            onClick={() => {
              setOpen(false);
              if (isApplied && !isStale && !isInterrupted) onShowLens();
              else onRun(lens);
            }}
          />
        );
      })}

      <MenuDivider />

      <MenuItem
        label={lenses.length > 0 ? 'Manage lenses…' : 'Add a lens…'}
        onClick={() => {
          setOpen(false);
          onManage();
        }}
      />
    </MenuPopover>
  );
}
