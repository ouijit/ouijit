/**
 * Status glyphs, colors, and labels for a changed file.
 *
 * Shared by every surface that renders a diff — the worktree panel and the
 * pull request files view — so a renamed file can't look like one thing in one
 * place and something else in the other.
 */

import type { ChangedFile } from '../../types';

export type DiffFileStatus = ChangedFile['status'];

export function statusIcon(status: DiffFileStatus | string): string {
  switch (status) {
    case 'A':
    case '?':
      return 'file-plus';
    case 'D':
      return 'file-minus';
    case 'R':
      return 'file-text';
    default:
      return 'file-dashed';
  }
}

export function statusColorClass(status: DiffFileStatus | string): string {
  switch (status) {
    case 'A':
      return 'text-vcs-added';
    case 'D':
      return 'text-vcs-deleted';
    case 'R':
      return 'text-vcs-renamed';
    case '?':
      return 'text-vcs-modified';
    default:
      return 'text-ink/50';
  }
}

export function badgeColorClass(status: DiffFileStatus | string): string {
  switch (status) {
    case 'A':
      return 'bg-vcs-added/15 text-vcs-added';
    case 'D':
      return 'bg-vcs-deleted/15 text-vcs-deleted';
    case 'R':
      return 'bg-vcs-renamed/15 text-vcs-renamed';
    case '?':
      return 'bg-vcs-modified/15 text-vcs-modified';
    default:
      return 'bg-ink/[0.06] text-ink/40';
  }
}

export function statusLabel(status: DiffFileStatus | string): string {
  switch (status) {
    case '?':
      return 'untracked';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}
