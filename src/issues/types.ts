/**
 * Issue shapes that are not a vendor's.
 *
 * The Issues list holds GitHub issues and Linear issues in the same groups, so
 * the row, the group and the timeline entry are declared here and both sources
 * map onto them. Runtime leaf, like `github/types.ts`.
 */

export type IssueSource = 'github' | 'linear';

export type TimelineItemKind = 'comment' | 'review' | 'commit' | 'event';

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url?: string;
  /** REST id of a comment, which is what deleting one takes. */
  databaseId?: number | null;
  /** GitHub's own answer on whether this viewer may delete it. */
  viewerCanDelete?: boolean;
  /** For reviews: APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED. */
  reviewState?: string;
  /** For events: 'merged', 'closed', 'reopened', … */
  eventType?: string;
}

/**
 * One row of the Issues list, from either source.
 *
 * `key` addresses the issue in its own store — a GitHub issue number, a Linear
 * issue id — and `identifier` is what the row prints: `#299`, `ENG-231`.
 */
export interface IssueRow {
  source: IssueSource;
  key: string;
  identifier: string;
  title: string;
  updatedAt: string;
  author: string;
  authorAvatarUrl?: string;
  /** Phosphor icon name and tint for the leading glyph. */
  icon: string;
  tone: string;
  /** An exact colour for the glyph, where the source has one of its own. */
  iconColor?: string;
  /** Task number linked to this issue, when there is one. */
  taskNumber?: number;
}

export interface IssueGroup {
  label: string;
  rows: IssueRow[];
  /** The group hit its limit, so it is a page rather than the whole answer. */
  capped: boolean;
}
