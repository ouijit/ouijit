import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';
import { Icon } from '../terminal/Icon';
import type { HealthStatus } from '../../healthCheck';

interface HelpDialogProps {
  onClose: () => void;
}

interface CliExample {
  command: string;
  desc: string;
}

const CLI_EXAMPLES: CliExample[] = [
  { command: 'ouijit task current', desc: 'Show the task this terminal owns' },
  { command: 'ouijit task list', desc: 'List all tasks' },
  { command: 'ouijit task set-status <n> in_review', desc: 'Move a task to In Review' },
  { command: 'ouijit task create "<name>"', desc: 'Create a new task' },
  { command: 'ouijit tag add <n> <tag>', desc: 'Tag a task' },
  { command: 'ouijit hook list', desc: 'Show configured project hooks' },
];

function HealthRow({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="shrink-0 w-2 h-2 rounded-full"
        style={{ background: ok ? 'rgb(48, 209, 88)' : 'rgb(255, 159, 10)' }}
      />
      <span className="text-text-primary font-medium w-20 shrink-0">{label}</span>
      <span className="text-text-secondary">{ok ? 'installed' : hint || 'not found'}</span>
    </div>
  );
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  const [visible, setVisible] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    window.api.health.check().then(setHealth);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  return (
    <DialogOverlay visible={visible} onDismiss={dismiss} maxWidth={520}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-text-secondary [&>svg]:w-4 [&>svg]:h-4 bg-white/5">
          <Icon name="question" />
        </div>
        <h2 className="text-lg font-semibold text-text-primary">Help &amp; Setup</h2>
      </div>

      <div className="max-h-[65vh] overflow-y-auto pr-1 -mr-1">
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Environment</h3>
          {health ? (
            <div className="flex flex-col gap-1.5">
              <HealthRow
                ok={health.git}
                label="git"
                hint="install via `xcode-select --install` (macOS) or your package manager"
              />
              <HealthRow ok={health.claude} label="claude" hint="not on PATH" />
              <HealthRow ok={health.codex} label="codex" hint="not on PATH" />
              <HealthRow ok={health.pi} label="pi" hint="not on PATH" />
              <HealthRow ok={health.opencode} label="opencode" hint="not on PATH" />
            </div>
          ) : (
            <div className="text-xs text-text-tertiary">Checking…</div>
          )}
        </section>

        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Connect a CLI agent</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Configure a <span className="text-text-primary font-medium">start hook</span> on the kanban board (the chip
            on the In Progress column). A start hook is the command that runs when you drag a task to In Progress.
            Usually it&apos;s just your agent: <code className="px-1 py-0.5 rounded bg-white/5 font-mono">claude</code>{' '}
            or <code className="px-1 py-0.5 rounded bg-white/5 font-mono">codex</code>. The task description is passed
            in as the prompt, and the agent figures out the rest using the{' '}
            <code className="px-1 py-0.5 rounded bg-white/5 font-mono">ouijit</code> CLI.
          </p>
        </section>

        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">The ouijit CLI</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            Available in every task terminal. Your agent uses it to read and update the board.
          </p>
          <div className="flex flex-col gap-1.5 mt-3 font-mono text-[11px]">
            {CLI_EXAMPLES.map((ex) => (
              <div key={ex.command} className="flex items-baseline gap-3">
                <code className="px-1.5 py-0.5 rounded bg-white/5 text-text-primary shrink-0">{ex.command}</code>
                <span className="text-text-tertiary text-xs">{ex.desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="flex justify-end mt-5">
        <button className="btn-primary px-5" onClick={dismiss}>
          Got it
        </button>
      </div>
    </DialogOverlay>
  );
}
