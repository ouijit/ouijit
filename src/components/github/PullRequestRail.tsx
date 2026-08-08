import { useMemo, type ReactNode } from 'react';
import type { ChangedFile } from '../../types';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import type { PrCommandSummary } from '../../github/service';
import type { LensGroup } from '../../github/prCommand';
import { DiffFileTree } from '../diff/DiffFileTree';
import { Icon } from '../terminal/Icon';
import { Tooltip } from '../ui/Tooltip';

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
      {lenses.length > 0 && (
        <div className="shrink-0 flex flex-col border-b border-ink/[0.06] py-1">
          <RailEntry
            label="All files"
            note={`${detail.changedFiles}`}
            active={!activeLens}
            onClick={() => onLens(null)}
          />
          {lenses.map((lens) => (
            <RailEntry
              key={lens.name}
              label={lens.name}
              note={lensRunning && activeLens === lens.name ? '…' : undefined}
              active={activeLens === lens.name}
              onClick={() => onLens(lens.name)}
            />
          ))}
        </div>
      )}

      {/* With none configured there is nothing to pick, but a capability the
          app never mentions is one nobody finds: the only way to add a lens is
          a CLI command, and you cannot run a command you have not heard of.
          Said once, quietly, at the foot of the list rather than as a control
          that does nothing when pressed. */}
      {lenses.length === 0 && (
        <div className="shrink-0 order-last border-t border-ink/[0.06] px-3 py-1.5 flex items-center gap-1.5">
          <span className="text-[11px] text-ink/35">Group by lens</span>
          <Tooltip
            placement="top"
            text={
              <span className="block max-w-[280px] whitespace-normal leading-snug font-normal">
                A lens reorders this diff into a reading order — yours to define, as any command printing{' '}
                <span className="font-mono">{'{"groups":[…]}'}</span>. Add one with{' '}
                <span className="font-mono">ouijit pr command set --name … --command … --mode lens</span>.
              </span>
            }
          >
            <Icon
              name="info"
              className="w-3.5 h-3.5 text-text-tertiary hover:text-text-secondary transition-colors duration-100"
            />
          </Tooltip>
        </div>
      )}

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
          header={
            lenses.length > 0 ? undefined : (
              <RailEntry
                label="All files"
                note={`${detail.changedFiles}`}
                active={activePath === null}
                onClick={() => onSelect(null)}
              />
            )
          }
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
}: {
  label: string;
  note?: string;
  active: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
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
