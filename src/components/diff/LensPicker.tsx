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
  lenses: LensSummary[];
  /**
   * The lens this diff has on file. A pull request drops a stale one — its hunks
   * are gone after a force-push — so it arrives named with no groups; a worktree
   * keeps rendering one, so it arrives with both.
   */
  onFile: StoredLens | null;
  resolved: ResolvedGroup[] | null;
  /** Whether the lens on file is the one on screen. */
  lensOn: boolean;
  changedFiles: number;
  /** Characters the prompt for this change would run to, estimated. */
  promptChars: number;
  /** Files marked read. A worktree diff has no such mark, and passes nothing. */
  viewed?: number;
  writing: LensRun | null;
  onAllFiles: () => void;
  /** Show the lens already written, without writing it again. */
  onShowLens: () => void;
  onRun: (lens: LensSummary) => void;
  onManage: () => void;
}

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
  staleOffered: boolean;
  /** A run from a session that ended before it finished. */
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
  /** The change will not fit one prompt, so some of it goes as line spans only. */
  tooBig: boolean;
}

/** What a grouping already on screen comes to. */
function appliedHint(parts: number | null, ungrouped: number, isStale: boolean): string {
  const count = plural(parts ?? 0, 'part');
  if (isStale) return `${count} · out of date`;
  return ungrouped > 0 ? `${count} · ${plural(ungrouped, 'file')} not grouped` : count;
}

function rowHint(lens: LensSummary, state: RowState): string | undefined {
  const { isApplied, isStale, isInterrupted, writing, parts, ungrouped, tooBig } = state;
  if (writing?.id === lens.id) return 'Writing…';
  if (isInterrupted) return 'did not finish';
  if (isApplied) return appliedHint(parts, ungrouped, isStale);
  if (isStale) return 'out of date';
  return tooBig ? 'too big to send whole' : undefined;
}

function rowTitle(
  lens: LensSummary,
  { isApplied, isStale, isInterrupted }: RowState,
  { since, promptChars, omitted }: { since: string | null; promptChars: number; omitted: number },
): string {
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
 * How to read the diff, as one choice — All files is a row in the same list.
 * Picking a lens that has not been written for this head writes it: a lens is an
 * agent run, and asking to read the change through one is what starts it.
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
  const coverage = resolved ? lensCoverage(resolved) : null;
  const parts = coverage?.parts ?? onFile?.groups?.length ?? null;
  const tooBig = promptChars > LENS_PROMPT_BUDGET;
  const showingLens = lensOn && rendered;
  // The lens that wrote what is on screen, if the project still has it. By id
  // first, since a rename moves the row and not the stored name; by name after,
  // since deleting a lens and writing it again mints a new id for what the
  // reader means by the same lens.
  const wrote = onFile
    ? (lenses.find((lens) => lens.id === onFile.lensId) ?? lenses.find((lens) => lens.name === onFile.lensName))
    : undefined;
  const appliedLabel = wrote?.name ?? onFile?.lensName ?? 'Lens';
  // A lens written by the CLI, or by one since deleted, has no row of its own in
  // the list below, so it gets one here.
  const orphan = rendered && !wrote;
  // Only where it can be acted on: a stale lens the project no longer has offers
  // nothing to run, so the notice would lead nowhere.
  const staleOffered = Boolean(onFile?.stale && wrote);
  // A run the app was killed out from under. The mark outlives the process that
  // made it, which is how one is told from a run still going.
  const interrupted = onFile?.running && !onFile.running.live ? onFile.running : null;

  const label = writing ? `Writing ${writing.name}…` : showingLens ? appliedLabel : 'All files';
  const note = showingLens ? `${parts}` : viewed ? `${viewed}/${changedFiles}` : `${changedFiles}`;

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      // Wider than the rail can be dragged, so a lens name has room to be read.
      className="w-[17rem] max-h-[22rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          title={triggerTitle({ writing, showingLens, onFile, label: appliedLabel, staleOffered, interrupted })}
          // Fills the ledge it is given rather than setting its own height:
          // what it lines up with sits across the seam, and the two surfaces
          // that draw this put a different thing there.
          className={`w-full h-full shrink-0 flex items-center gap-1.5 pl-3 pr-3 text-[13px] text-left transition-colors duration-150 ease-out hover:bg-ink/5 ${
            open ? 'bg-ink/[0.07] text-ink' : writing ? 'text-ink/45' : 'text-ink/70'
          }`}
          onClick={() => setOpen(!open)}
        >
          <Icon name={showingLens ? 'aperture' : 'tree-structure'} className="shrink-0 w-4 h-4 opacity-70" />
          <span className="flex-1 min-w-0 truncate">{label}</span>
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
      <MenuItem
        label="All files"
        hint={viewed ? `${viewed}/${changedFiles} read` : `${changedFiles}`}
        selected={!showingLens}
        onClick={() => {
          setOpen(false);
          onAllFiles();
        }}
      />

      {(lenses.length > 0 || (orphan && onFile)) && <MenuDivider />}

      {orphan && onFile && (
        <MenuItem
          label={appliedLabel}
          hint={appliedHint(parts, coverage?.ungrouped ?? 0, onFile.stale)}
          selected={showingLens}
          // No offer to write it again: the project has no lens by this name.
          title={onFile.stale ? 'Written for an earlier version of this change' : 'Written for this change'}
          onClick={() => {
            setOpen(false);
            onShowLens();
          }}
        />
      )}

      {lenses.map((lens) => {
        const isApplied = rendered && wrote?.id === lens.id;
        // A drifted lens is a run to start again, whether or not it is the one
        // on screen: showing it only shows the older change again.
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
            // One run at a time. The lens already written and still current is a
            // view to switch to rather than a run to start, so it stays live.
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
