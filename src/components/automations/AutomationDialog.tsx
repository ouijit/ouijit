import { useEffect, useRef, useState } from 'react';
import type {
  Automation,
  AutomationInput,
  AutomationKind,
  MissedRunPolicy,
  RunLocation,
} from '../../automations/types';
import { describeSchedule, parseCron } from '../../automations/schedule';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { DIALOG_INPUT_CLASS, DIALOG_MONO_INPUT_CLASS } from '../dialogs/dialogStyles';
import { QuietPicker } from '../ui/QuietPicker';
import { useSandboxOptions } from '../ui/SandboxPicker';
import { useProjectDataStore, loadScripts } from '../../stores/projectDataStore';
import { SANDBOX_LABELS, type SandboxProviderId } from '../../types';

type Cadence = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'manual' | 'custom';

const CADENCES: Cadence[] = ['hourly', 'daily', 'weekdays', 'weekly', 'manual', 'custom'];
const CADENCE_LABELS: Record<Cadence, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  manual: 'Manual',
  custom: 'Custom (cron)',
};
const DAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const LABEL_CLASS = 'text-sm font-medium text-text-secondary';
const TEXTAREA_CLASS =
  'w-full min-h-24 px-4 py-2 text-sm text-text-primary bg-background border border-border rounded-md outline-none transition-all duration-150 ease-out focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary font-sans resize-y';

/** A draft the empty page's examples start from. */
export type AutomationDraft = Partial<AutomationInput>;

interface ScheduleFields {
  cadence: Cadence;
  time: string;
  day: (typeof DAYS)[number];
  cron: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The form's fields for a cron the presets wrote, or the cron itself under Custom. */
function scheduleFields(cron: string | null | undefined): ScheduleFields {
  const base: ScheduleFields = { cadence: 'weekdays', time: '09:00', day: '1', cron: '0 9 * * 1-5' };
  if (cron === undefined) return base;
  if (cron === null) return { ...base, cadence: 'manual' };
  const described = describeSchedule(cron);
  const [minute, hour, , , weekday] = cron.split(/\s+/);
  const time = /^\d+$/.test(hour) && /^\d+$/.test(minute) ? `${pad(Number(hour))}:${pad(Number(minute))}` : '09:00';
  if (described === 'Hourly') return { ...base, cadence: 'hourly', cron };
  if (described.startsWith('Daily')) return { ...base, cadence: 'daily', time, cron };
  if (described.startsWith('Weekdays')) return { ...base, cadence: 'weekdays', time, cron };
  if (described.endsWith(`s at ${time}`)) {
    return { ...base, cadence: 'weekly', time, day: weekday as ScheduleFields['day'], cron };
  }
  return { ...base, cadence: 'custom', cron };
}

function cronFor(fields: ScheduleFields): string | null {
  const [hour, minute] = fields.time.split(':').map(Number);
  switch (fields.cadence) {
    case 'hourly':
      return '0 * * * *';
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'weekly':
      return `${minute} ${hour} * * ${fields.day}`;
    case 'manual':
      return null;
    case 'custom':
      return fields.cron.trim();
  }
}

export function AutomationDialog({
  projectPath,
  existing,
  draft,
  onClose,
}: {
  projectPath: string;
  existing?: Automation;
  draft?: AutomationDraft;
  onClose: () => void;
}) {
  const start = existing ?? draft;
  const [name, setName] = useState(start?.name ?? '');
  const [kind, setKind] = useState<AutomationKind>(start?.kind ?? 'agent');
  const [prompt, setPrompt] = useState(start?.prompt ?? '');
  const [command, setCommand] = useState(start?.command ?? '');
  const [schedule, setSchedule] = useState(() => scheduleFields(start?.schedule));
  const [missed, setMissed] = useState<MissedRunPolicy>(start?.missed ?? 'run-once');
  const [location, setLocation] = useState<RunLocation>(start?.location ?? 'worktree');
  const [sandbox, setSandbox] = useState<SandboxProviderId>(start?.sandbox ?? 'nono');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const sandboxOptions = useSandboxOptions(projectPath, sandbox);
  const scripts = useProjectDataStore((s) => s.scriptsByProject[projectPath]) ?? [];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    nameRef.current?.focus();
    void loadScripts(projectPath);
  }, [projectPath]);

  const dismiss = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const cron = cronFor(schedule);
  let cronError: string | null = null;
  if (schedule.cadence === 'custom') {
    try {
      parseCron(schedule.cron);
    } catch (e) {
      cronError = e instanceof Error ? e.message : String(e);
    }
  }
  const ready = name.trim() !== '' && (kind === 'agent' ? prompt.trim() !== '' : command.trim() !== '') && !cronError;

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const input: AutomationInput = {
      name,
      kind,
      ...(kind === 'agent' ? { prompt } : { command }),
      schedule: cron,
      missed,
      location,
      sandbox,
    };
    const result = await window.api.automations.save(projectPath, input, existing?.id);
    if ('error' in result) {
      setError(result.error);
      setSaving(false);
      return;
    }
    dismiss();
  };

  const timed = schedule.cadence === 'daily' || schedule.cadence === 'weekdays' || schedule.cadence === 'weekly';

  return (
    <DialogOverlay visible={visible} onDismiss={dismiss}>
      <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">
        {existing ? 'Edit Automation' : 'New Automation'}
      </h2>

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="automation-name">
            Name
          </label>
          <input
            ref={nameRef}
            id="automation-name"
            className={DIALOG_INPUT_CLASS}
            placeholder="PR triage"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className={LABEL_CLASS}>Runs</span>
          <QuietPicker<AutomationKind>
            label="Runs"
            value={kind}
            options={['agent', 'command']}
            optionLabel={(k) => (k === 'agent' ? 'Agent with a prompt' : 'Command')}
            onChange={setKind}
          />
        </div>

        {kind === 'agent' ? (
          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS} htmlFor="automation-prompt">
              Prompt
            </label>
            <textarea
              id="automation-prompt"
              className={TEXTAREA_CLASS}
              placeholder="Triage new pull requests and stage review comments"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="text-xs text-text-tertiary">Runs the project's start hook with this prompt.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <label className={LABEL_CLASS} htmlFor="automation-command">
                Command
              </label>
              {scripts.length > 0 && (
                <QuietPicker
                  label="From a script"
                  value=""
                  options={['', ...scripts.map((s) => s.command)]}
                  optionLabel={(c) => (c === '' ? 'From a script' : (scripts.find((s) => s.command === c)?.name ?? c))}
                  onChange={(c) => c && setCommand(c)}
                />
              )}
            </div>
            <input
              id="automation-command"
              className={DIALOG_MONO_INPUT_CLASS}
              placeholder="npm audit"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className={LABEL_CLASS}>Schedule</span>
          <div className="flex items-center gap-1">
            {schedule.cadence === 'weekly' && (
              <QuietPicker
                label="Day"
                value={schedule.day}
                options={DAYS}
                optionLabel={(d) => DAY_LABELS[Number(d)]}
                onChange={(day) => setSchedule({ ...schedule, day })}
              />
            )}
            {timed && (
              <input
                type="time"
                aria-label="Time"
                className="h-7 px-2 text-xs text-text-secondary bg-transparent rounded-md outline-none hover:bg-ink/[0.08] focus:bg-ink/[0.08]"
                value={schedule.time}
                onChange={(e) => e.target.value && setSchedule({ ...schedule, time: e.target.value })}
              />
            )}
            <QuietPicker
              label="Schedule"
              value={schedule.cadence}
              options={CADENCES}
              optionLabel={(c) => CADENCE_LABELS[c]}
              onChange={(cadence) => setSchedule({ ...schedule, cadence })}
            />
          </div>
        </div>
        {schedule.cadence === 'custom' && (
          <div className="flex flex-col gap-1">
            <input
              aria-label="Cron expression"
              className={DIALOG_MONO_INPUT_CLASS}
              placeholder="0 9 * * 1-5"
              value={schedule.cron}
              onChange={(e) => setSchedule({ ...schedule, cron: e.target.value })}
            />
            <p className="text-xs text-text-tertiary">
              {cronError ?? 'Minute, hour, day, month, weekday, in local time. At most every 15 minutes.'}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className={LABEL_CLASS}>Missed runs</span>
          <QuietPicker<MissedRunPolicy>
            label="Missed runs"
            value={missed}
            options={['run-once', 'skip']}
            optionLabel={(m) => (m === 'run-once' ? 'Run once' : 'Skip')}
            optionDetail={(m) =>
              m === 'run-once'
                ? 'One catch-up run when Ouijit is back, for the latest missed time'
                : 'Wait for the next scheduled time'
            }
            onChange={setMissed}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className={LABEL_CLASS}>Works in</span>
          <QuietPicker<RunLocation>
            label="Works in"
            value={location}
            options={['worktree', 'project']}
            optionLabel={(l) => (l === 'worktree' ? 'A fresh worktree' : 'The project folder')}
            optionDetail={(l) =>
              l === 'worktree' ? 'Removed after a quiet run' : 'For runs that only read; no worktree to set up'
            }
            onChange={setLocation}
          />
        </div>

        {sandboxOptions.length > 1 && (
          <div className="flex items-center justify-between gap-3">
            <span className={LABEL_CLASS}>Run in</span>
            <QuietPicker<SandboxProviderId>
              label="Run in"
              value={sandbox}
              options={sandboxOptions}
              optionLabel={(id) => SANDBOX_LABELS[id]}
              onChange={setSandbox}
            />
          </div>
        )}
        {sandbox === 'none' && (
          <p className="text-xs text-text-tertiary">
            On the host, an agent with its permission checks off can reach anything you can.
          </p>
        )}

        {error && <p className="text-xs text-error">{error}</p>}
      </div>

      <div className="flex gap-2 justify-end mt-4">
        <button className="btn-secondary" onClick={dismiss}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!ready || saving} onClick={() => void save()}>
          Save
        </button>
      </div>
    </DialogOverlay>
  );
}
