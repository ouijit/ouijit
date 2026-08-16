/**
 * Status glyphs, colors, and labels for a changed file.
 *
 * Read by the worktree diff panel and the pull request files view.
 */

import type { ChangedFile } from '../../types';

export type DiffFileStatus = ChangedFile['status'];

interface StatusStyle {
  icon: string;
  color: string;
  badge: string;
  label: string;
}

/** Modified is also the fallback: anything git reports that isn't one of these. */
const MODIFIED: StatusStyle = {
  icon: 'file-dashed',
  color: 'text-ink/50',
  badge: 'bg-ink/[0.06] text-ink/40',
  label: 'modified',
};

const STYLES: Record<string, StatusStyle> = {
  A: { icon: 'file-plus', color: 'text-vcs-added', badge: 'bg-vcs-added/15 text-vcs-added', label: 'added' },
  D: { icon: 'file-minus', color: 'text-vcs-deleted', badge: 'bg-vcs-deleted/15 text-vcs-deleted', label: 'deleted' },
  R: { icon: 'file-text', color: 'text-vcs-renamed', badge: 'bg-vcs-renamed/15 text-vcs-renamed', label: 'renamed' },
  // Untracked shares the added icon but keeps its own colour: git has no
  // record of the file at all.
  '?': {
    icon: 'file-plus',
    color: 'text-vcs-modified',
    badge: 'bg-vcs-modified/15 text-vcs-modified',
    label: 'untracked',
  },
};

function styleFor(status: DiffFileStatus | string): StatusStyle {
  return STYLES[status] ?? MODIFIED;
}

export function statusIcon(status: DiffFileStatus | string): string {
  return styleFor(status).icon;
}

export function statusColorClass(status: DiffFileStatus | string): string {
  return styleFor(status).color;
}

export function badgeColorClass(status: DiffFileStatus | string): string {
  return styleFor(status).badge;
}

export function statusLabel(status: DiffFileStatus | string): string {
  return styleFor(status).label;
}
