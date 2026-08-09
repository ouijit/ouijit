import { useState } from 'react';
import type { LensSummary } from '../../github/service';
import { Icon } from '../terminal/Icon';
import { MenuDivider, MenuItem, MenuPopover } from './ActionMenu';

/** The lens on this pull request: what wrote it, and how many parts it names. */
export interface AppliedLens {
  /** Null when an agent posted groups over the CLI rather than through a lens. */
  name: string | null;
  groups: number;
}

interface LensPickerProps {
  /** The lenses the project keeps, in the order it keeps them. */
  lenses: LensSummary[];
  applied: AppliedLens | null;
  /** Whether the applied lens is the one on screen. */
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
  applied,
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

  const showingLens = lensOn && applied !== null;
  const appliedLabel = applied?.name ?? 'Lens';
  // A lens written by the CLI, or by one since renamed or deleted, has no row
  // of its own in the list below — it gets one here so what is on screen can
  // always be named and gone back to.
  const orphan = applied !== null && !lenses.some((lens) => lens.name === applied.name);

  const label = writing ? `Writing ${writing}…` : showingLens ? appliedLabel : 'All files';
  const note = showingLens ? `${applied.groups}` : viewed > 0 ? `${viewed}/${changedFiles}` : `${changedFiles}`;

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
                ? 'How to read this change'
                : applied?.name
                  ? `Reading this change through “${applied.name}”`
                  : 'Reading this change through a lens written for it'
          }
          className={`w-full h-9 shrink-0 flex items-center gap-1.5 pl-3 pr-3 text-[13px] text-left transition-colors duration-150 ease-out hover:bg-ink/5 ${
            open ? 'bg-ink/[0.07] text-ink' : writing ? 'text-ink/45' : 'text-ink/70'
          }`}
          onClick={() => setOpen(!open)}
        >
          <Icon name={showingLens ? 'aperture' : 'tree-structure'} className="shrink-0 w-4 h-4 opacity-70" />
          <span className="flex-1 min-w-0 truncate">{label}</span>
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
        icon="tree-structure"
        hint={viewed > 0 ? `${viewed}/${changedFiles} read` : `${changedFiles}`}
        selected={!showingLens}
        onClick={() => {
          setOpen(false);
          onAllFiles();
        }}
      />

      <MenuDivider />

      {orphan && applied && (
        <MenuItem
          label={appliedLabel}
          icon="aperture"
          hint={`${applied.groups} parts`}
          selected={showingLens}
          title="Written for this change"
          onClick={() => {
            setOpen(false);
            onShowLens();
          }}
        />
      )}

      {lenses.map((lens) => {
        const isApplied = applied?.name === lens.name;
        return (
          <MenuItem
            key={lens.name}
            label={lens.name}
            icon="aperture"
            hint={writing === lens.name ? 'Writing…' : isApplied ? `${applied.groups} parts` : undefined}
            selected={isApplied && lensOn}
            // One run at a time — but the lens already written is a view to
            // switch to, not a run to start, so it stays live.
            disabled={Boolean(writing) && !isApplied}
            title={isApplied ? lens.instruction : `Read this change through “${lens.name}”`}
            onClick={() => {
              setOpen(false);
              if (isApplied) onShowLens();
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
