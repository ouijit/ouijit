import { useCallback, useState } from 'react';
import type { Automation, AutomationRun, RunState } from '../../automations/types';
import { describeSchedule } from '../../automations/schedule';
import { useProjectAutomations } from '../../stores/automationStore';
import { useAppStore } from '../../stores/appStore';
import { useEscape } from '../../hooks/useEscape';
import { Icon } from '../terminal/Icon';
import { PanelFrame } from '../ui/PanelFrame';
import { Tooltip } from '../ui/Tooltip';
import { Section } from '../issues/Sections';
import { AutomationDialog, type AutomationDraft } from './AutomationDialog';
import { makeTask, openRun, runNow } from './runActions';

const EXAMPLES: AutomationDraft[] = [
  {
    name: 'PR triage',
    kind: 'agent',
    prompt:
      'Look at pull requests opened or updated since yesterday. Stage review comments on the ones that need them.',
    schedule: '0 9 * * 1-5',
  },
  {
    name: 'Dependency audit',
    kind: 'agent',
    prompt: 'Check for outdated or vulnerable dependencies. If any matter, say which and why.',
    schedule: '0 2 * * *',
  },
  { name: 'Nightly tests', kind: 'command', command: 'npm test', schedule: '0 3 * * *', location: 'worktree' },
];

const STATE_LABELS: Record<RunState, string> = {
  queued: 'Queued',
  running: 'Running',
  quiet: 'Quiet',
  'needs-you': 'Needs you',
  failed: 'Failed',
  skipped: 'Skipped',
};

const STATE_TONE: Record<RunState, string> = {
  queued: 'text-text-tertiary',
  running: 'text-accent',
  quiet: 'text-text-tertiary',
  'needs-you': 'text-text-primary',
  failed: 'text-error',
  skipped: 'text-text-tertiary',
};

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? `Today ${time}`
    : `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

const ICON_BUTTON =
  'w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-ink/10 transition-colors duration-100';

type DialogState = { existing?: Automation; draft?: AutomationDraft } | null;

export function AutomationsPage({ projectPath }: { projectPath: string }) {
  const { automations, runs } = useProjectAutomations(projectPath);
  const [dialog, setDialog] = useState<DialogState>(null);

  useEscape(useCallback(() => useAppStore.getState().showProjectTerminals(projectPath), [projectPath]));

  return (
    <PanelFrame>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-2 px-4">
          <Icon name="clock-clockwise" className="w-4 h-4 text-text-secondary" />
          <span className="text-[13px] font-medium text-text-primary">Automations</span>
          <button type="button" className="ml-auto btn-secondary" onClick={() => setDialog({})}>
            New automation
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-7">
            {automations.length === 0 ? (
              <EmptyState onPick={(draft) => setDialog({ draft })} />
            ) : (
              automations.map((automation) => (
                <AutomationSection
                  key={automation.id}
                  automation={automation}
                  runs={runs.filter((r) => r.automationId === automation.id)}
                  onEdit={() => setDialog({ existing: automation })}
                />
              ))
            )}
          </div>
        </div>
      </div>
      {dialog && (
        <AutomationDialog
          projectPath={projectPath}
          existing={dialog.existing}
          draft={dialog.draft}
          onClose={() => setDialog(null)}
        />
      )}
    </PanelFrame>
  );
}

function EmptyState({ onPick }: { onPick: (draft: AutomationDraft) => void }) {
  return (
    <div className="flex flex-col gap-4 py-8">
      <p className="text-[15px] text-text-secondary">
        Run a command or an agent on a schedule. Runs stay off the board; you hear about the ones that need you.
      </p>
      <div className="flex flex-col">
        {EXAMPLES.map((draft) => (
          <div key={draft.name} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-ink/5">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-text-primary">{draft.name}</div>
              <div className="text-[12px] text-text-tertiary truncate">
                {describeSchedule(draft.schedule ?? null)} · {draft.kind === 'agent' ? draft.prompt : draft.command}
              </div>
            </div>
            <button type="button" className="btn-secondary" onClick={() => onPick(draft)}>
              Create
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutomationSection({
  automation,
  runs,
  onEdit,
}: {
  automation: Automation;
  runs: AutomationRun[];
  onEdit: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const schedule = automation.paused ? 'Paused' : describeSchedule(automation.schedule);
  const next = !automation.paused && automation.nextRunAt ? ` · next ${when(automation.nextRunAt)}` : '';

  return (
    <Section label={automation.name} count={runs.filter((r) => r.unread).length} defaultOpen>
      <div className="flex items-center gap-2 px-2 pb-3">
        <span className="flex-1 min-w-0 truncate text-[12px] text-text-tertiary">
          {schedule}
          {next} · {automation.kind === 'agent' ? automation.prompt : automation.command}
        </span>
        <Tooltip text="Run now" placement="bottom">
          <button
            type="button"
            aria-label={`Run ${automation.name} now`}
            className={ICON_BUTTON}
            onClick={() => void runNow(automation.id, automation.name, automation.projectPath)}
          >
            <Icon name="play" className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        {automation.schedule && (
          <Tooltip text={automation.paused ? 'Resume' : 'Pause'} placement="bottom">
            <button
              type="button"
              aria-label={automation.paused ? `Resume ${automation.name}` : `Pause ${automation.name}`}
              className={ICON_BUTTON}
              onClick={() => void window.api.automations.setPaused(automation.id, !automation.paused)}
            >
              <Icon name={automation.paused ? 'play' : 'pause'} className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
        <Tooltip text="Edit" placement="bottom">
          <button type="button" aria-label={`Edit ${automation.name}`} className={ICON_BUTTON} onClick={onEdit}>
            <Icon name="pencil-simple" className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        {confirmDelete ? (
          <button
            type="button"
            className="btn-secondary text-error"
            onBlur={() => setConfirmDelete(false)}
            onClick={() => void window.api.automations.delete(automation.id)}
          >
            Delete
          </button>
        ) : (
          <Tooltip text="Delete" placement="bottom">
            <button
              type="button"
              aria-label={`Delete ${automation.name}`}
              className={ICON_BUTTON}
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
      {runs.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-text-tertiary">No runs yet.</p>
      ) : (
        <div className="flex flex-col">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} label={automation.name} />
          ))}
        </div>
      )}
    </Section>
  );
}

function RunRow({ run, label }: { run: AutomationRun; label: string }) {
  const [showOutput, setShowOutput] = useState(false);
  const going = run.state === 'running' || run.state === 'queued';
  const detail = run.summary ?? run.reason ?? (run.exitCode ? `Exited ${run.exitCode}` : '');
  const canMakeTask = !going && !!run.worktreePath && run.taskNumber === undefined;
  const canDismiss = !going && (run.unread || (!!run.worktreePath && run.taskNumber === undefined));

  const open = async () => {
    const opened = going || run.worktreePath || run.taskNumber !== undefined ? await openRun(run, label) : false;
    if (!opened) {
      if (run.unread) void window.api.automations.dismissRun(run.id);
      setShowOutput((v) => !v);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="group flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-ink/5">
        <button type="button" className="flex-1 min-w-0 flex items-center gap-3 text-left" onClick={() => void open()}>
          {run.unread && <span aria-label="Unread" className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
          <span className={`w-20 shrink-0 text-[12px] ${STATE_TONE[run.state]} ${run.unread ? 'font-medium' : ''}`}>
            {STATE_LABELS[run.state]}
          </span>
          <span className="w-36 shrink-0 text-[12px] text-text-tertiary">
            {when(run.startedAt ?? run.scheduledFor)}
            {run.trigger === 'catch-up' && ' · caught up'}
          </span>
          <span className="flex-1 min-w-0 truncate text-[12px] text-text-secondary">
            {run.taskNumber !== undefined ? `T-${run.taskNumber}` : detail}
          </span>
        </button>
        {canMakeTask && (
          <button type="button" className="btn-secondary" onClick={() => void makeTask(run)}>
            Make a task
          </button>
        )}
        {canDismiss && (
          <Tooltip text="Dismiss" placement="bottom">
            <button
              type="button"
              aria-label="Dismiss"
              className={ICON_BUTTON}
              onClick={() => void window.api.automations.dismissRun(run.id)}
            >
              <Icon name="x" className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
      {showOutput && (
        <pre className="mx-2 mb-2 px-3 py-2 max-h-80 overflow-auto rounded-md bg-ink/[0.045] font-mono text-[11px] text-text-secondary whitespace-pre-wrap">
          {run.output || 'No output.'}
        </pre>
      )}
    </div>
  );
}
