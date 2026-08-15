import { useState } from 'react';
import type { LensSummary } from '../../lens/config';
import { Icon } from '../terminal/Icon';
import { MenuDivider, MenuItem, MenuPopover } from '../ui/Menu';

/**
 * The lens this diff has on file.
 *
 * Freshness rides with it rather than beside it, because the two diffs disagree
 * about what a lens that has drifted means and a separate flag could only
 * describe one of them. A pull request drops a stale lens — its hunks are gone
 * after a force-push — so it has a name and no parts. A worktree keeps rendering
 * one, since the diff moves on every save and a lens written a minute ago still
 * groups most of it, so it has both. Either way the row for it offers to write
 * it again, which is the thing the two-flag version could not say.
 */
export interface LensOnFile {
  /** Null when an agent posted groups over the CLI rather than through a lens. */
  name: string | null;
  /** How many parts it names, or null when it is on file but not rendered. */
  groups: number | null;
  /** Written against a different diff than the one on screen. */
  stale: boolean;
}

interface LensPickerProps {
  /** The lenses the project keeps, in the order it keeps them. */
  lenses: LensSummary[];
  onFile: LensOnFile | null;
  /** Whether the lens on file is the one on screen. */
  lensOn: boolean;
  changedFiles: number;
  viewed: number;
  /** Name of the lens being written, if a run is in flight for this pull request. */
  writing: string | null;
  onAllFiles: () => void;
  /** Show the lens already written, without writing it again. */
  onShowLens: () => void;
  onRun: (lens: LensSummary) => void;
  /** Add, edit and delete the project's lenses. */
  onManage: () => void;
}

/**
 * How to read the diff, as one choice.
 *
 * All files is a lens like any other — the one that groups nothing and takes
 * the order the diff arrived in — so it sits in the same list as the rest
 * rather than in a control of its own. Two side-by-side rows said the opposite:
 * that the file list and a lens were different kinds of thing, and left the
 * project's other lenses hidden behind a caret on the second one.
 *
 * Picking a lens that has not been written for this head writes it: a lens is
 * an agent run, and the reader asking to read this change through one is the
 * only reason to start it.
 */
export function LensPicker({
  lenses,
  onFile,
  lensOn,
  changedFiles,
  viewed,
  writing,
  onAllFiles,
  onShowLens,
  onRun,
  onManage,
}: LensPickerProps) {
  const [open, setOpen] = useState(false);

  const rendered = onFile !== null && onFile.groups !== null;
  const showingLens = lensOn && rendered;
  const appliedLabel = onFile?.name ?? 'Lens';
  // A lens written by the CLI, or by one since renamed or deleted, has no row
  // of its own in the list below — it gets one here so what is on screen can
  // always be named and gone back to.
  const orphan = rendered && !lenses.some((lens) => lens.name === onFile.name);
  // Marked only where it can be acted on. A stale lens the project no longer
  // has — renamed, deleted, or never one of its own — has no row to carry the
  // notice and nothing to offer, so it is left unsaid.
  const staleName = onFile?.stale ? onFile.name : null;
  const staleOffered = staleName !== null && lenses.some((lens) => lens.name === staleName);

  const label = writing ? `Writing ${writing}…` : showingLens ? appliedLabel : 'All files';
  const note = showingLens ? `${onFile.groups}` : viewed > 0 ? `${viewed}/${changedFiles}` : `${changedFiles}`;

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
          title={
            writing
              ? `${writing} is running. The lens appears here when it writes one.`
              : !showingLens
                ? staleOffered
                  ? `How to read this change — “${staleName}” was written for earlier commits`
                  : 'How to read this change'
                : onFile?.stale
                  ? `Reading this change through “${appliedLabel}”, written for an earlier version of it`
                  : onFile?.name
                    ? `Reading this change through “${onFile.name}”`
                    : 'Reading this change through a lens written for it'
          }
          className={`w-full h-9 shrink-0 flex items-center gap-1.5 pl-3 pr-3 text-[13px] text-left transition-colors duration-150 ease-out hover:bg-ink/5 ${
            open ? 'bg-ink/[0.07] text-ink' : writing ? 'text-ink/45' : 'text-ink/70'
          }`}
          onClick={() => setOpen(!open)}
        >
          <Icon name={showingLens ? 'aperture' : 'tree-structure'} className="shrink-0 w-4 h-4 opacity-70" />
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {/* Something is waiting behind a control nobody has to open. Without
              it, a reader who never opens the picker never learns that the run
              they paid for describes commits that are no longer here. */}
          {staleOffered && !writing && <span aria-hidden className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />}
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
        hint={viewed > 0 ? `${viewed}/${changedFiles} read` : `${changedFiles}`}
        selected={!showingLens}
        onClick={() => {
          setOpen(false);
          onAllFiles();
        }}
      />

      <MenuDivider />

      {orphan && onFile && (
        <MenuItem
          label={appliedLabel}
          hint={onFile.stale ? `${onFile.groups} parts · out of date` : `${onFile.groups} parts`}
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
        const isApplied = rendered && onFile.name === lens.name;
        const isStale = staleOffered && staleName === lens.name;
        // A lens that has drifted is a run to start again, whether or not it is
        // the one on screen. Showing it is not an option that leads anywhere:
        // when it is rendered the reader is already looking at it, and the
        // notice they want acting on is that it describes an older change.
        const reruns = isStale;
        return (
          <MenuItem
            key={lens.name}
            label={lens.name}
            hint={
              writing === lens.name
                ? 'Writing…'
                : isApplied && isStale
                  ? `${onFile.groups} parts · out of date`
                  : isApplied
                    ? `${onFile.groups} parts`
                    : isStale
                      ? 'out of date'
                      : undefined
            }
            selected={isApplied && lensOn}
            // One run at a time. The lens already written and still current is
            // a view to switch to rather than a run to start, so it stays live.
            disabled={Boolean(writing) && (reruns || !isApplied)}
            title={
              isApplied && isStale
                ? `Written for an earlier version of this change — read it again through “${lens.name}”`
                : isApplied
                  ? lens.instruction
                  : isStale
                    ? `Written for earlier commits — read this change through “${lens.name}” again`
                    : `Read this change through “${lens.name}”`
            }
            onClick={() => {
              setOpen(false);
              if (isApplied && !reruns) onShowLens();
              else onRun(lens);
            }}
          />
        );
      })}

      {lenses.length === 0 && (
        <div className="px-2.5 py-1.5 text-[11px] text-text-tertiary leading-relaxed">
          A lens names the parts of a change, so the diff can be read in the order it was made.
        </div>
      )}

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
