import type { TaskWithWorkspace } from '@app/types';
import type { TerminalDisplayState } from '@app/stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '@app/stores/terminalStore';
import type { TaskChainInfo } from '@app/utils/taskChain';
import { buildChainMap } from '@app/utils/taskChain';

const PROJECT_PATH = '/demo/horizon';

function term(partial: Partial<TerminalDisplayState> & { ptyId: string }): TerminalDisplayState {
  return {
    ...DEFAULT_DISPLAY_STATE,
    projectPath: PROJECT_PATH,
    ...partial,
  };
}

/**
 * A more populated project fixture for the features page.
 * Spreads work across all four statuses so the board reads as a real project.
 *
 * T-101 is the focal in_progress task; its terminal stack is what overlaps the
 * board in the workspace scene.
 */
export const featuresTasks: TaskWithWorkspace[] = [
  // Todo
  {
    taskNumber: 118,
    name: 'Wire payment retries to dunning queue',
    status: 'todo',
    branch: 'wire-payment-retries',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-118',
    createdAt: '2026-05-08T08:00:00Z',
  },
  {
    taskNumber: 117,
    name: 'Add CSV export to invoices table',
    status: 'todo',
    branch: 'invoices-csv-export',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-117',
    createdAt: '2026-05-08T07:30:00Z',
  },
  {
    taskNumber: 116,
    name: 'Bump deps for security advisory',
    status: 'todo',
    branch: 'bump-deps-advisory',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-116',
    createdAt: '2026-05-07T17:00:00Z',
  },

  // In Progress
  {
    taskNumber: 101,
    name: 'Rework onboarding flow',
    status: 'in_progress',
    branch: 'rework-onboarding',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-101',
    createdAt: '2026-05-06T10:00:00Z',
    prompt:
      'Split the existing single-page onboarding into a stepper with saved progress, and move the welcome copy into a reusable intro component so the marketing site can embed it too.',
  },
  {
    taskNumber: 103,
    name: 'Polish invitation email template',
    status: 'in_progress',
    branch: 'polish-invitation-email',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-103',
    createdAt: '2026-05-06T10:00:00Z',
  },
  {
    taskNumber: 104,
    name: 'Refine CTA button hover states',
    status: 'in_progress',
    branch: 'refine-cta-hover',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-104',
    createdAt: '2026-05-07T10:00:00Z',
    parentTaskNumber: 103,
  },
  {
    taskNumber: 105,
    name: 'Audit accessibility on settings dialog',
    status: 'in_progress',
    branch: 'a11y-settings',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-105',
    createdAt: '2026-05-07T11:00:00Z',
  },

  // In Review
  {
    taskNumber: 99,
    name: 'Speed up search index build',
    status: 'in_review',
    branch: 'speed-search-index',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-99',
    createdAt: '2026-05-07T13:30:00Z',
  },
  {
    taskNumber: 98,
    name: 'Refactor billing webhook router',
    status: 'in_review',
    branch: 'billing-webhook-router',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-98',
    createdAt: '2026-05-06T15:00:00Z',
  },

  // Done
  {
    taskNumber: 95,
    name: 'Restore login redirect after timeout',
    status: 'done',
    branch: 'login-redirect',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-95',
    createdAt: '2026-05-05T09:00:00Z',
  },
  {
    taskNumber: 94,
    name: 'Add per-row selection to invoices',
    status: 'done',
    branch: 'invoices-row-select',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-94',
    createdAt: '2026-05-05T08:00:00Z',
  },
];

export const featuresChainMap: Map<number, TaskChainInfo> = buildChainMap(featuresTasks);

/** Connected terminals per task. Only T-101 needs a populated stack here — the
 * other in-progress tasks just show one terminal so cards have realistic badges. */
export const featuresTerminalsByTask: Record<number, TerminalDisplayState[]> = {
  101: [
    term({
      ptyId: 'pty-101-claude',
      label: 'claude',
      summaryType: 'thinking',
      taskId: 101,
      lastOscTitle: 'Editing onboarding stepper...',
    }),
    term({ ptyId: 'pty-101-dev', label: 'npm run dev', taskId: 101 }),
    term({ ptyId: 'pty-101-test', label: 'npm test', summaryType: 'ready', taskId: 101 }),
    term({ ptyId: 'pty-101-shell', label: 'shell', summaryType: 'ready', taskId: 101 }),
  ],
  103: [term({ ptyId: 'pty-103-claude', label: 'claude', summaryType: 'thinking', taskId: 103 })],
  104: [
    term({
      ptyId: 'pty-104-claude',
      label: 'claude',
      summaryType: 'thinking',
      sandboxed: true,
      taskId: 104,
    }),
  ],
  105: [term({ ptyId: 'pty-105-claude', label: 'claude', taskId: 105 })],
  98: [term({ ptyId: 'pty-98-claude', label: 'claude', summaryType: 'ready', taskId: 98 })],
};

export const FEATURES_PROJECT_PATH = PROJECT_PATH;
