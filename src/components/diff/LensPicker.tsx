import { useState } from 'react';
import type { LensSummary } from '../../lens/config';
import type { StoredLens } from '../../lens/readLens';
import { lensCoverage } from '../../lens/lens';
import { count } from '../../analysis/advice';
import { LENS_PROMPT_BUDGET } from '../../lens/lensPrompt';
import type { LensRun, LensSession } from './useLensSession';
import { formatRelativeTime } from '../../utils/formatDate';
import { Icon } from '../terminal/Icon';
import { MenuDivider, MenuItem, MenuPopover } from '../ui/Menu';

interface LensPickerProps {
  session: LensSession;
  lenses: LensSummary[];
  changedFiles: number;
  promptChars: number;
  /** Files marked read. A worktree diff has no such mark, and passes nothing. */
  viewed?: number;
  /** Shows the lens on file, or the flat list. Never writes one. */
  onLensOn: (on: boolean) => void;
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
  label: string;
  staleOffered: boolean;
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

/** Roughly four characters to a token — close enough for a number with a tilde. */
function tokenLabel(chars: number): string {
  const tokens = Math.round(chars / 4);
  return tokens >= 1000 ? `~${Math.round(tokens / 1000)}k tk` : `~${tokens} tk`;
}

interface RowState {
  isApplied: boolean;
  isStale: boolean;
  isInterrupted: boolean;
}

function appliedHint(parts: number | null, ungrouped: number, isStale: boolean): string {
  const partCount = count(parts ?? 0, 'part');
  if (isStale) return `${partCount} · out of date`;
  return ungrouped > 0 ? `${partCount} · ${count(ungrouped, 'file')} not grouped` : partCount;
}

function rowHint(
  lens: LensSummary,
  { isApplied, isStale, isInterrupted }: RowState,
  {
    writing,
    parts,
    ungrouped,
    tooBig,
  }: {
    writing: LensRun | null;
    parts: number | null;
    /** Changed files the lens on screen claimed none of. */
    ungrouped: number;
    /** The change will not fit one prompt, so some of it goes as line spans only. */
    tooBig: boolean;
  },
): string | undefined {
  if (writing?.id === lens.id) return 'Writing…';
  if (isInterrupted) return 'did not finish';
  if (isApplied) return appliedHint(parts, ungrouped, isStale);
  if (isStale) return 'out of date';
  return tooBig ? 'too big to send whole' : undefined;
}

function rowTitle(
  lens: LensSummary,
  { isApplied, isStale, isInterrupted }: RowState,
  {
    since,
    promptChars,
    omitted,
  }: {
    since: string | null;
    promptChars: number;
    omitted: number;
  },
): string {
  const size = ` — ${tokenLabel(promptChars)}`;

  if (isInterrupted) {
    const started = since ? `Started ${formatRelativeTime(new Date(since))}` : 'Started';
    return `${started} and never finished — read this change through “${lens.name}” again${size}`;
  }
  if (isApplied) {
    if (isStale) return `Written for an earlier version of this change — read it again through “${lens.name}”${size}`;
    return omitted > 0
      ? `${lens.instruction} — ${count(omitted, 'hunk')} were too large to quote and were grouped from their line spans`
      : lens.instruction;
  }
  return isStale
    ? `Written for earlier commits — read this change through “${lens.name}” again${size}`
    : `Read this change through “${lens.name}”${size}`;
}

/**
 * All files is a row in the same list. Picking a lens that has not been written
 * for this head spends an agent run writing it.
 */
export function LensPicker({
  session,
  lenses,
  changedFiles,
  promptChars,
  viewed,
  onLensOn,
  onManage,
}: LensPickerProps) {
  const [open, setOpen] = useState(false);
  const { lens: onFile, resolved, lensOn, writing } = session;

  const rendered = onFile?.groups != null;
  const coverage = resolved ? lensCoverage(resolved) : null;
  const parts = coverage?.parts ?? onFile?.groups?.length ?? null;
  const tooBig = promptChars > LENS_PROMPT_BUDGET;
  const showingLens = lensOn && rendered;
  // By id first, since a rename moves the row and not the stored name; by name
  // after, since deleting a lens and writing it again mints a new id for what the
  // reader means by the same lens.
  const wrote = onFile
    ? (lenses.find((lens) => lens.id === onFile.lensId) ?? lenses.find((lens) => lens.name === onFile.lensName))
    : undefined;
  const appliedLabel = wrote?.name ?? onFile?.lensName ?? 'Lens';
  // A lens written by the CLI, or by one since deleted, has no row of its own in
  // the list below, so it gets one here.
  const orphan = rendered && !wrote;
  // Only where it can be acted on: a stale lens the project has since deleted
  // offers nothing to run.
  const staleOffered = Boolean(onFile?.stale && wrote);
  // The mark outlives the process that made it, which is how a run the app was
  // killed out from under is told from one still going.
  const interrupted = onFile?.running && !onFile.running.live ? onFile.running : null;

  const ungrouped = coverage?.ungrouped ?? 0;
  const hintFacts = { writing, parts, ungrouped, tooBig };
  const titleFacts = { since: interrupted?.since ?? null, promptChars, omitted: onFile?.omitted ?? 0 };

  const label = writing ? `Writing ${writing.name}…` : showingLens ? appliedLabel : 'All files';
  // A diff that tracks nothing read says how many files there are; one that does
  // says how far through them the reader is, from the first file on.
  const files = viewed === undefined ? `${changedFiles}` : `${viewed}/${changedFiles}`;
  const note = showingLens ? `${parts}` : files;

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
        hint={viewed === undefined ? files : `${files} read`}
        selected={!showingLens}
        onClick={() => {
          setOpen(false);
          onLensOn(false);
        }}
      />

      {(lenses.length > 0 || (orphan && onFile)) && <MenuDivider />}

      {orphan && onFile && (
        <MenuItem
          label={appliedLabel}
          hint={appliedHint(parts, ungrouped, onFile.stale)}
          selected={showingLens}
          // No offer to write it again: the project has no lens by this name.
          title={onFile.stale ? 'Written for an earlier version of this change' : 'Written for this change'}
          onClick={() => {
            setOpen(false);
            onLensOn(true);
          }}
        />
      )}

      {lenses.map((lens) => {
        const isApplied = rendered && wrote?.id === lens.id;
        // A drifted lens is a run to start again even when it is the one on
        // screen: showing it only shows the older change.
        const isStale = staleOffered && wrote?.id === lens.id;
        const isInterrupted = interrupted?.lensId === lens.id;
        const row = { isApplied, isStale, isInterrupted };
        return (
          <MenuItem
            key={lens.id}
            label={lens.name}
            hint={rowHint(lens, row, hintFacts)}
            selected={isApplied && lensOn}
            // One run at a time, except the lens already written and current:
            // that row switches the view rather than starting a run.
            disabled={Boolean(writing) && (isStale || !isApplied)}
            title={rowTitle(lens, row, titleFacts)}
            onClick={() => {
              setOpen(false);
              if (isApplied && !isStale && !isInterrupted) onLensOn(true);
              else void session.run(lens);
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
