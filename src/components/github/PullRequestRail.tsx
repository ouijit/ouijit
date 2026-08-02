import { useMemo } from 'react';
import type { ChangedFile } from '../../types';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import { DiffFileTree } from '../diff/DiffFileTree';
import { Icon } from '../terminal/Icon';
import { SECTION_IDS, type SectionId } from './DocumentSection';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  /** Section id or file path currently under the top of the viewport. */
  active: string | null;
  onJumpToSection: (section: SectionId) => void;
  onJumpToFile: (path: string) => void;
}

/**
 * Contents for the whole pull request, not just its files.
 *
 * The document puts the discussion above the diff, which is the right reading
 * order and the wrong order for someone who came back only to look at one file.
 * The rail is the answer to that: every part of the document is one click away,
 * and it reports where you currently are.
 */
export function PullRequestRail({ detail, files, active, onJumpToSection, onJumpToFile }: PullRequestRailProps) {
  const changedFiles: ChangedFile[] = useMemo(() => files.map(toChangedFile), [files]);

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
    <div className="w-[220px] shrink-0 flex flex-col overflow-hidden border-r border-ink/[0.06]">
      <DiffFileTree
        files={changedFiles}
        activePath={active}
        onFileClick={onJumpToFile}
        renderFileTrailing={(file) => {
          const count = unresolvedByPath.get(file.path);
          if (!count) return null;
          return (
            <span
              className="shrink-0 font-mono text-[10px] px-1.5 py-px rounded-full bg-accent/15 text-accent"
              title="Unresolved threads"
            >
              {count}
            </span>
          );
        }}
        header={
          <>
            <RailEntry
              label="Description"
              active={active === SECTION_IDS.description}
              onClick={() => onJumpToSection('description')}
            />
            <RailEntry
              label="Checks"
              count={detail.checks.length}
              tone={failing > 0 ? 'error' : undefined}
              active={active === SECTION_IDS.checks}
              onClick={() => onJumpToSection('checks')}
            />
            <RailEntry
              label="Discussion"
              count={unresolved > 0 ? unresolved : undefined}
              tone={unresolved > 0 ? 'accent' : undefined}
              active={active === SECTION_IDS.discussion}
              onClick={() => onJumpToSection('discussion')}
            />
            <RailHeading label="Files" count={detail.changedFiles} onClick={() => onJumpToSection('files')} />
          </>
        }
      />
    </div>
  );
}

function RailEntry({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  tone?: 'accent' | 'error';
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
      {count != null && count > 0 && (
        <span
          className={`shrink-0 font-mono text-[10px] px-1.5 py-px rounded-full ${
            tone === 'error'
              ? 'bg-vcs-deleted/15 text-vcs-deleted'
              : tone === 'accent'
                ? 'bg-accent/15 text-accent'
                : 'text-ink/40'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Separates the document's prose from its files, the way the document does. */
function RailHeading({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className="w-full flex items-center gap-1.5 py-1 pl-3 pr-3 mt-1 pt-2 border-t border-ink/[0.06] text-[13px] text-left text-ink/40 hover:text-ink/60 transition-colors duration-150"
      onClick={onClick}
    >
      <Icon name="code" className="w-3.5 h-3.5" />
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-mono text-[10px]">{count}</span>
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
