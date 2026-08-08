import { useMemo, type ReactNode } from 'react';
import type { ChangedFile } from '../../types';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import type { PrCommandSummary } from '../../github/service';
import type { LensGroup } from '../../github/prCommand';
import { DiffFileTree } from '../diff/DiffFileTree';
import { useProjectStore } from '../../stores/projectStore';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  /** Null shows the whole diff in order. */
  activePath: string | null;
  onSelect: (path: string | null) => void;
  prCommands: PrCommandSummary[];
  activeLens: string | null;
  lensGroups: LensGroup[] | null;
  lensRunning: boolean;
  onLens: (name: string | null) => void;
}

/**
 * The changed files, for the code pane only.
 *
 * Reviewing a file at a time is the case this is built around: the diff gets
 * the rest of the width, and moving to the next file is one click rather than
 * a scroll past everything in between.
 */
export function PullRequestRail({
  detail,
  files,
  activePath,
  onSelect,
  prCommands,
  activeLens,
  lensGroups,
  lensRunning,
  onLens,
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

  const lenses = useMemo(() => prCommands.filter((c) => c.mode === 'lens'), [prCommands]);

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
      {/* A file list is the order the change was written in, not the order it
          reads in. A lens is someone's answer to that, and it is a press —
          nothing regroups on its own, because arranging a diff can cost a
          model call and a diff you cannot see yet is worse than an unsorted
          one. */}
      <div className="shrink-0 flex flex-col border-b border-ink/[0.06] py-1">
        <RailEntry
          label="All files"
          note={`${detail.changedFiles}`}
          active={!activeLens && activePath === null}
          onClick={() => {
            onSelect(null);
            onLens(null);
          }}
        />
        {lenses.map((lens) => (
          <RailEntry
            key={lens.name}
            label={lens.name}
            note={lensRunning && activeLens === lens.name ? '…' : undefined}
            active={activeLens === lens.name && activePath === null}
            onClick={() => {
              // Already the active lens: this is "back to the whole document",
              // not "run it again". Re-running would spend another model call
              // to produce the grouping already on screen.
              onSelect(null);
              if (activeLens !== lens.name) onLens(lens.name);
            }}
          />
        ))}
        {/* Configured none, and the row still stands where a lens would: it is
            the only place in the app a reader learns the diff can be ordered
            some other way, and it goes somewhere real rather than explaining
            itself and leaving them to find settings alone. */}
        {lenses.length === 0 && (
          <RailEntry
            label="Add a lens…"
            muted
            active={false}
            title="Group this diff into a reading order, using a command you define"
            onClick={() => useProjectStore.getState().setActivePanel('settings')}
          />
        )}
      </div>

      {lensGroups ? (
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {lensGroups.map((group) => (
            <div key={group.title} className="flex flex-col">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink/40" title={group.summary}>
                {group.title}
              </div>
              {group.paths.map((path) => (
                <RailEntry
                  key={path}
                  label={path.split('/').pop() ?? path}
                  active={activePath === path}
                  onClick={() => onSelect(path)}
                  trailing={trailing(path)}
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
  muted,
  title,
}: {
  label: string;
  note?: string;
  active: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  muted?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`w-full flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] text-left transition-colors duration-150 ease-out hover:bg-ink/5 ${
        active ? 'bg-ink/[0.07] text-ink' : muted ? 'text-ink/40' : 'text-ink/70'
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
