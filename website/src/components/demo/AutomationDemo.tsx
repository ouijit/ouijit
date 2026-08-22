import { HookRowView } from '../../ouijit-ui/components/scripts/HookRowView';
import { ScriptRowView } from '../../ouijit-ui/components/scripts/ScriptRowView';

const HOOKS: { label: string; description: string; command?: string }[] = [
  {
    label: 'Start',
    description: 'Task moves from To Do to In Progress',
    command: 'claude "$OUIJIT_TASK_DESCRIPTION"',
  },
  {
    label: 'Continue',
    description: 'Reopening a task already In Progress',
    command: 'claude --continue',
  },
  {
    label: 'Run',
    description: 'The Run button or a runner panel opens',
    command: 'npm run dev',
  },
  {
    label: 'Review',
    description: 'Task moves to In Review',
    command: 'gh pr create --fill',
  },
  {
    label: 'Done',
    description: 'Task moves to Done',
    command: 'git push origin HEAD',
  },
];

const SCRIPTS = [
  { name: 'Install deps', command: 'npm install' },
  { name: 'Reset DB', command: 'npm run db:reset' },
  { name: 'Run tests', command: 'npm test' },
];

export default function AutomationDemo() {
  return (
    <div className="flex flex-col gap-4">
      <div className="demo-frame">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <div className="text-xs font-semibold text-text-primary">Lifecycle Hooks</div>
          <div className="text-[11px] text-text-tertiary">
            Commands that run automatically as a task moves through states.
          </div>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {HOOKS.map((h) => (
            <HookRowView key={h.label} label={h.label} description={h.description} command={h.command} />
          ))}
        </div>
      </div>
      <div className="demo-frame">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <div className="text-xs font-semibold text-text-primary">Run Scripts</div>
          <div className="text-[11px] text-text-tertiary">From any terminal in the project, one click.</div>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {SCRIPTS.map((s) => (
            <ScriptRowView key={s.name} name={s.name} command={s.command} />
          ))}
        </div>
      </div>
    </div>
  );
}
