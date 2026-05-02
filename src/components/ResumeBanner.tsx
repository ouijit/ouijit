/**
 * One-shot at-launch affordance: if a session snapshot was persisted on the
 * previous quit and any of its terminals are still restorable, show a banner
 * offering to resume them. The chevron expands a list grouped by project so
 * the user can verify what's coming back before committing. Hidden once
 * acted on (Resume or Dismiss clears the snapshot).
 */

import { useEffect, useMemo, useState } from 'react';
import { readSnapshot, clearSnapshot } from './terminal/sessionSnapshot';
import { listRestorable, restoreSession, summarizeRestorable, type RestorableEntry } from './terminal/sessionRestore';
import { Icon } from './terminal/Icon';
import { stringToColor, getInitials } from '../utils/projectIcon';
import type { LastSessionSnapshot, Project, TaskStatus } from '../types';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'to do',
  in_progress: 'in progress',
  in_review: 'to review',
  done: 'done',
};

export function ResumeBanner() {
  const [snapshot, setSnapshot] = useState<LastSessionSnapshot | null>(null);
  const [entries, setEntries] = useState<RestorableEntry[] | null>(null);
  const [resuming, setResuming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await readSnapshot();
      if (cancelled || !snap || snap.terminals.length === 0) return;
      const list = await listRestorable(snap);
      if (cancelled) return;
      if (list.length === 0) {
        // Nothing left worth restoring — clear silently.
        await clearSnapshot();
        return;
      }
      setSnapshot(snap);
      setEntries(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => (entries ? summarizeRestorable(entries) : null), [entries]);

  const grouped = useMemo(() => {
    if (!entries) return [] as { project: Project; entries: RestorableEntry[] }[];
    const map = new Map<string, { project: Project; entries: RestorableEntry[] }>();
    for (const entry of entries) {
      const existing = map.get(entry.project.path);
      if (existing) {
        existing.entries.push(entry);
      } else {
        map.set(entry.project.path, { project: entry.project, entries: [entry] });
      }
    }
    for (const group of map.values()) {
      group.entries.sort((a, b) => a.ordinalInProject - b.ordinalInProject);
    }
    return [...map.values()];
  }, [entries]);

  if (dismissed || !snapshot || !entries || !counts) return null;

  const handleResume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      await restoreSession(snapshot);
    } finally {
      await clearSnapshot();
      setDismissed(true);
    }
  };

  const handleDismiss = async () => {
    setDismissed(true);
    await clearSnapshot();
  };

  const { total, tasks, projects } = counts;
  const terminalLabel = total === 1 ? 'terminal' : 'terminals';
  const taskLabel = tasks === 1 ? 'task' : 'tasks';
  const projectLabel = projects === 1 ? 'project' : 'projects';
  const subtitle =
    tasks > 0
      ? `${total} ${terminalLabel} across ${tasks} ${taskLabel} and ${projects} ${projectLabel}`
      : `${total} ${terminalLabel} across ${projects} ${projectLabel}`;

  return (
    <div
      className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden shrink-0"
      style={{
        background: 'var(--color-terminal-bg)',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
      }}
    >
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm text-text-primary leading-tight">Resume last session</span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide session details' : 'Show session details'}
            className="inline-flex items-center gap-1 mt-0.5 self-start text-[11px] text-text-tertiary hover:text-text-secondary transition-colors duration-100 [-webkit-app-region:no-drag]"
          >
            <span>{subtitle}</span>
            <Icon
              name="caret-down"
              className={`w-2.5 h-2.5 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
            />
          </button>
        </div>
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag] shrink-0">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={resuming}
            className="px-3 py-1.5 text-xs text-text-secondary rounded-full hover:bg-white/[0.04] transition-colors disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleResume}
            disabled={resuming}
            className="px-4 py-1.5 text-xs font-medium text-white bg-accent rounded-full hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
          >
            {resuming ? 'Resuming…' : 'Resume'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-white/[0.06] max-h-[14rem] overflow-y-auto settings-scrollable">
          {grouped.map((group, idx) => (
            <ProjectGroup key={group.project.path} group={group} isFirst={idx === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectGroup({
  group,
  isFirst,
}: {
  group: { project: Project; entries: RestorableEntry[] };
  isFirst: boolean;
}) {
  return (
    <div className={isFirst ? '' : 'border-t border-white/[0.04]'}>
      <div className="flex items-center gap-2 px-5 pt-2.5 pb-1">
        <ProjectThumb project={group.project} />
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary truncate">{group.project.name}</span>
      </div>
      <ul className="flex flex-col">
        {group.entries.map((entry, idx) => (
          <li key={`${entry.taskNumber ?? 'shell'}-${entry.ordinalInProject}-${idx}`}>
            <EntryRow entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryRow({ entry }: { entry: RestorableEntry }) {
  const isTask = entry.taskNumber != null;
  const title = isTask ? entry.taskName || 'Untitled' : entry.label || 'Shell';
  return (
    <div className="flex items-center gap-2 px-5 py-1.5 min-w-0">
      {isTask ? (
        <span className="font-mono text-[11px] text-text-tertiary tabular-nums shrink-0 w-10">
          T-{entry.taskNumber}
        </span>
      ) : (
        <span className="shrink-0 w-10 flex items-center text-text-tertiary">
          <Icon name="terminal" className="w-3 h-3" />
        </span>
      )}
      <span className="text-[12px] text-text-secondary truncate flex-1">{title}</span>
      {isTask && entry.taskStatus && (
        <span className="text-[10px] text-text-tertiary shrink-0 uppercase tracking-wider">
          {STATUS_LABEL[entry.taskStatus]}
        </span>
      )}
    </div>
  );
}

function ProjectThumb({ project }: { project: Project }) {
  return (
    <div className="w-4 h-4 overflow-hidden rounded-[3px] shrink-0">
      {project.iconDataUrl ? (
        <img src={project.iconDataUrl} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-white"
          style={{
            backgroundColor: stringToColor(project.name),
            fontSize: 7,
            fontWeight: 700,
            textShadow: '0 1px 1px rgba(0, 0, 0, 0.2)',
          }}
        >
          {getInitials(project.name)}
        </div>
      )}
    </div>
  );
}
