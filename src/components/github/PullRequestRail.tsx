import { useMemo, type ReactNode } from 'react';
import type { ChangedFile } from '../../types';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import type { ResolvedGroup } from '../../github/lens';
import { DiffFileTree } from '../diff/DiffFileTree';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  /** Null shows the whole diff in order. */
  activePath: string | null;
  onSelect: (path: string | null) => void;
  /** The lens as bound to this diff, or null when none has been written. */
  groups: ResolvedGroup[] | null;
  lensOn: boolean;
  onLensOn: (on: boolean) => void;
}

/**
 * The changed files, for the code pane only.
 *
 * Reviewing a file at a time is the case this is built around: the diff gets
 * the rest of the width, and moving to the next file is one click rather than
 * a scroll past everything in between.
 *
 * With a lens on, the same rail lists the parts of the change instead — and a
 * file that belongs to three parts appears in all three, because that is the
 * point of it.
 */
export function PullRequestRail({
  detail,
  files,
  activePath,
  onSelect,
  groups,
  lensOn,
  onLensOn,
}: PullRequestRailProps) {
  const changedFiles: ChangedFile[] = useMemo(() => files.map(toChangedFile), [files]);

  const unresolvedByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of detail.threads) {
      if (thread.isResolved) continue;
      counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
    }
    return counts;
  }, [detail.threads]);

  const trailing = (path: string) => {
    const count = unresolvedByPath.get(path);
    if (!count) return null;
    return (
      <span className="shrink-0 font-mono text-[10px] text-accent" title="Unresolved threads">
        {count}
      </span>
    );
  };

  return (
    <div className="w-[228px] shrink-0 flex flex-col overflow-hidden border-r border-ink/[0.06]">
      {/* A diff arrives in the order the change was stored, not the order it
          reads in. A lens is one answer to that, written for this change and no
          other; the toggle is here because a reading order is a way of looking
          at the diff, not a replacement for it. */}
      <div className="shrink-0 flex flex-col border-b border-ink/[0.06] py-1">
        <RailEntry
          label="All files"
          note={`${detail.changedFiles}`}
          active={!lensOn && activePath === null}
          onClick={() => {
            onSelect(null);
            onLensOn(false);
          }}
        />
        {groups ? (
          <RailEntry
            label="Read as a story"
            note={`${groups.length}`}
            active={lensOn && activePath === null}
            title="Group this diff into the parts of the change"
            onClick={() => {
              onSelect(null);
              onLensOn(true);
            }}
          />
        ) : (
          // A state, not a control: there is nothing to press until something
          // has read the diff. Said anyway, because a reader who has never seen
          // one has no other way to learn the Code pane can be read in the
          // order the change was made rather than the order it was stored.
          <div
            className="px-3 py-1 text-[13px] text-ink/35"
            title="Run a review command from the action bar above, and an agent can write one"
          >
            No reading order yet
          </div>
        )}
      </div>

      {lensOn && groups ? (
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink/40" title={group.summary}>
                {group.title}
              </div>
              {group.slices.map((slice) => (
                <RailEntry
                  key={`${group.title}:${slice.path}`}
                  label={slice.path.split('/').pop() ?? slice.path}
                  title={slice.path}
                  note={slice.hunks.length > 1 ? `${slice.hunks.length}` : undefined}
                  active={activePath === slice.path}
                  onClick={() => onSelect(slice.path)}
                  trailing={trailing(slice.path)}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <DiffFileTree
          files={changedFiles}
          activePath={activePath}
          onFileClick={onSelect}
          renderFileTrailing={(file) => trailing(file.path)}
        />
      )}
    </div>
  );
}

function RailEntry({
  label,
  note,
  active,
  onClick,
  trailing,
  title,
}: {
  label: string;
  note?: string;
  active: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`w-full flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] text-left transition-colors duration-150 ease-out hover:bg-ink/5 ${
        active ? 'bg-ink/[0.07] text-ink' : 'text-ink/70'
      }`}
      onClick={onClick}
    >
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {note && <span className="shrink-0 font-mono text-[11px] text-ink/35">{note}</span>}
      {trailing}
    </button>
  );
}

function toChangedFile(file: PullRequestFile): ChangedFile {
  return {
    path: file.path,
    status: file.status,
    ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    additions: file.additions,
    deletions: file.deletions,
  };
}
