import type { ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { HookRowView } from '../../ouijit-ui/components/scripts/HookRowView';
import { ScriptRowView } from '../../ouijit-ui/components/scripts/ScriptRowView';
import { MockScale } from './MockScale';

/**
 * The sandbox page's two settings panels, in the app's own chrome. The page's
 * other visuals are a diagram and code, drawn in the page itself.
 */

function Panel({ ledge, children }: { ledge?: string; children: ReactNode }) {
  return (
    <div
      className="glass-bevel relative flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden w-full"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      {ledge && (
        <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center px-4 text-[13px] text-ink/70">{ledge}</div>
      )}
      <div className="flex flex-col divide-y divide-ink/[0.06]">{children}</div>
    </div>
  );
}

function Select({ value }: { value: string }) {
  return (
    <span className="w-[8.5rem] shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 text-sm bg-ink/[0.04] border border-ink/10 rounded-md text-text-primary">
      <span className="truncate">{value}</span>
      <Icon name="caret-down" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
    </span>
  );
}

function WhereThingsRun() {
  return (
    <Panel>
      <div className="flex items-center gap-4 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-text-primary">Default</div>
          <div className="text-[11px] text-text-tertiary mt-0.5">Where terminals, hooks and scripts run</div>
        </div>
        <Select value="Host" />
      </div>
      <HookRowView
        label="Start"
        description="Runs when a task moves to In Progress"
        command={'claude --dangerously-skip-permissions "$OUIJIT_TASK_DESCRIPTION"'}
        sandboxLabel="Sandbox"
      />
      <HookRowView label="Done" description="Runs when a task moves to Done" command="git push -u origin HEAD" />
      <ScriptRowView name="Dev server" command="npm run dev" />
    </Panel>
  );
}

const ACCESS = [
  { label: 'Read only', detail: 'Its task, the notes on its diff, drafts, and asking you', on: true },
  { label: 'Its own task', detail: 'Also move, rename and describe it' },
  { label: 'Everything', detail: 'What a host terminal can' },
];

function Radio({ on }: { on?: boolean }) {
  return (
    <span
      className={`w-3.5 h-3.5 shrink-0 rounded-full border flex items-center justify-center ${
        on ? 'border-accent bg-accent' : 'border-ink/30'
      }`}
    >
      {on && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
    </span>
  );
}

function CliAccess() {
  return (
    <Panel ledge="Ouijit CLI access">
      {ACCESS.map((a) => (
        <div key={a.label} className="flex items-center gap-3 px-3 py-2.5">
          <Radio on={a.on} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-primary">{a.label}</div>
            <div className="text-[11px] text-text-tertiary mt-0.5">{a.detail}</div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

/* The width each panel lays out at; below it the panel scales rather than
   reflows. Kept at or under the row's visual column, so neither shrinks at
   desktop widths. */
const MOCKS = {
  where: { width: 540, Mock: WhereThingsRun },
  access: { width: 420, Mock: CliAccess },
} as const;

export type SandboxMockKind = keyof typeof MOCKS;

export function SandboxMock({ kind }: { kind: SandboxMockKind }) {
  const { width, Mock } = MOCKS[kind];
  return (
    <MockScale width={width}>
      <Mock />
    </MockScale>
  );
}
