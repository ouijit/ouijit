import { useMemo } from 'react';
import type { ChangedFile } from '../../types';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import { DiffFileTree } from '../diff/DiffFileTree';
import { filePathOf, type PrSection } from './DocumentSection';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  section: PrSection;
  onSelect: (section: PrSection) => void;
}

/**
 * The rail is the navigation. Picking a part of the pull request shows that
 * part and nothing else — the description, the checks, the discussion, all the
 * files at once, or one file on its own.
 *
 * Reviewing a file at a time is the case this is built around: the diff gets
 * the whole pane, and moving to the next file is one click rather than a scroll
 * past everything in between.
 */
export function PullRequestRail({ detail, files, section, onSelect }: PullRequestRailProps) {
  const changedFiles: ChangedFile[] = useMemo(() => files.map(toChangedFile), [files]);
  const activePath = filePathOf(section);

  const unresolvedByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of detail.threads) {
      if (thread.isResolved) continue;
      counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
    }
    return counts;
  }, [detail.threads]);

  const unresolved = detail.threads.filter((t) => !t.isResolved).length;
  const failing = detail.checks.filter(
    (c) =>
      (!c.status || c.status === 'COMPLETED') &&
      ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(c.conclusion ?? ''),
  ).length;

  return (
    <div className="w-[228px] shrink-0 flex flex-col overflow-hidden border-r border-ink/[0.06]">
      <DiffFileTree
        files={changedFiles}
        activePath={activePath}
        onFileClick={(path) => onSelect(`file:${path}`)}
        renderFileTrailing={(file) => {
          const count = unresolvedByPath.get(file.path);
          if (!count) return null;
          return (
            <span className="shrink-0 font-mono text-[10px] text-accent" title="Unresolved threads">
              {count}
            </span>
          );
        }}
        header={
          <div className="pb-2 mb-1 border-b border-ink/[0.06]">
            <RailEntry label="Description" active={section === 'description'} onClick={() => onSelect('description')} />
            <RailEntry
              label="Checks"
              note={failing > 0 ? `${failing} failing` : detail.checks.length > 0 ? 'passing' : undefined}
              alert={failing > 0}
              active={section === 'checks'}
              onClick={() => onSelect('checks')}
            />
            <RailEntry
              label="Discussion"
              note={unresolved > 0 ? `${unresolved}` : undefined}
              active={section === 'discussion'}
              onClick={() => onSelect('discussion')}
            />
            <RailEntry
              label="All files"
              note={`${detail.changedFiles}`}
              active={section === 'files'}
              onClick={() => onSelect('files')}
            />
          </div>
        }
      />
    </div>
  );
}

function RailEntry({
  label,
  note,
  alert,
  active,
  onClick,
}: {
  label: string;
  note?: string;
  alert?: boolean;
  active: boolean;
  onClick: () => void;
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
      {note && (
        <span className={`shrink-0 font-mono text-[10px] ${alert ? 'text-vcs-deleted' : 'text-ink/35'}`}>{note}</span>
      )}
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
