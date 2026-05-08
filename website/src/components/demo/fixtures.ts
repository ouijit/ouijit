import type { TaskWithWorkspace } from '@app/types';
import type { TerminalDisplayState } from '@app/stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '@app/stores/terminalStore';
import type { TaskChainInfo } from '@app/utils/taskChain';
import { buildChainMap } from '@app/utils/taskChain';

const PROJECT_PATH = '/demo/horizon';

/** Helper to build a TerminalDisplayState with sensible defaults. */
function term(partial: Partial<TerminalDisplayState> & { ptyId: string }): TerminalDisplayState {
  return {
    ...DEFAULT_DISPLAY_STATE,
    projectPath: PROJECT_PATH,
    ...partial,
  };
}

export const demoTasks: TaskWithWorkspace[] = [
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
    taskNumber: 102,
    name: 'Add activity feed to dashboard',
    status: 'in_progress',
    branch: 'add-activity-feed',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-102',
    createdAt: '2026-05-05T10:00:00Z',
  },
  {
    taskNumber: 103,
    name: 'Polish invitation email template',
    status: 'in_progress',
    branch: 'polish-invitation-email',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-103',
    createdAt: '2026-05-06T10:00:00Z',
    prompt:
      'Tighten typography, swap the inline button styles for the new tokens, and make sure the plain-text fallback still renders. Send a test through the staging mailer.',
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
  {
    taskNumber: 106,
    name: 'Add per-row selection to invoices table',
    status: 'in_progress',
    branch: 'invoices-row-select',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-106',
    createdAt: '2026-05-07T12:00:00Z',
  },
  {
    taskNumber: 107,
    name: 'Speed up search index build',
    status: 'in_progress',
    branch: 'speed-search-index',
    worktreePath: '/demo/horizon/.ouijit/worktrees/T-107',
    createdAt: '2026-05-07T13:30:00Z',
  },
];

export const demoChainMap: Map<number, TaskChainInfo> = buildChainMap(demoTasks);

/** Connected terminals per task, keyed by taskNumber. */
export const demoTerminalsByTask: Record<number, TerminalDisplayState[]> = {
  101: [
    term({ ptyId: 'pty-101-claude', label: 'claude', summaryType: 'thinking', taskId: 101 }),
    term({ ptyId: 'pty-101-dev', label: 'npm run dev', taskId: 101 }),
  ],
  102: [term({ ptyId: 'pty-102-claude', label: 'claude', summaryType: 'thinking', taskId: 102 })],
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
  106: [term({ ptyId: 'pty-106-claude', label: 'claude', summaryType: 'thinking', taskId: 106 })],
  107: [],
};

export const PROJECT_PATH_DEMO = PROJECT_PATH;

/** Compose a list of tasks with helper accessor for terminals. */
export function getDemoTaskWithTerminals(taskNumber: number) {
  const task = demoTasks.find((t) => t.taskNumber === taskNumber);
  return {
    task: task!,
    terminals: demoTerminalsByTask[taskNumber] ?? [],
  };
}
