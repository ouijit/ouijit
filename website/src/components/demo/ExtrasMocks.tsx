import type { ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import { ScriptRowView } from '../../ouijit-ui/components/scripts/ScriptRowView';
import { HookRowView } from '../../ouijit-ui/components/scripts/HookRowView';
import { KeyHint, PaletteHeader, PaletteRow } from './paletteParts';

/**
 * Static renders of app chrome for the "Also in the box." bento. Each mock
 * copies its component's real classes — palette, settings rows, terminal
 * header fragments — so the tiles show the product, not an illustration.
 */

const METADATA_CHIP =
  'inline-flex items-center gap-1 font-mono text-[11px] font-medium text-ink/55 bg-ink/[0.05] rounded-full px-2 py-0.5 shrink-0';

/** Every mock is a window: the app renders the palette, settings sections,
 * and banners as bevelled glass panels on terminal-bg. */
function FloatingPanel({ children, divided = false }: { children: ReactNode; divided?: boolean }) {
  return (
    <div
      className={`glass-bevel relative flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden w-full ${
        divided ? 'divide-y divide-ink/[0.06]' : ''
      }`}
      style={{ background: 'var(--color-terminal-bg)', boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)' }}
    >
      {children}
    </div>
  );
}

export function PaletteMock() {
  return (
    <FloatingPanel>
      <PaletteHeader query="onboarding" />
      <div className="px-3 pt-2 pb-1 text-[11px] text-ink/40">Terminals</div>
      <PaletteRow
        selected
        leading={<StatusDot summaryType="thinking" />}
        title="claude"
        context="Rework onboarding flow"
      />
      <PaletteRow leading={<StatusDot summaryType="ready" />} title="npm run dev" context="Rework onboarding flow" />
      <div className="px-3 pt-2 pb-1 text-[11px] text-ink/40">Tasks</div>
      <PaletteRow
        leading={<span className="font-mono text-[11px] text-text-tertiary tabular-nums">T-101</span>}
        title="Rework onboarding flow"
        context="ouijit"
        meta="in review · 2h"
      />
      <div className="shrink-0 flex items-center gap-4 px-3 py-2 border-t border-ink/[0.06] text-[11px] text-ink/40">
        <KeyHint keys="↑↓" label="Navigate" />
        <KeyHint keys="↵" label="Focus terminal" />
        <span className="flex-1" />
        <KeyHint keys="esc" label="Close" />
      </div>
    </FloatingPanel>
  );
}

export function SandboxMock() {
  return (
    <FloatingPanel>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <StatusDot summaryType="thinking" sandboxed />
        <span className="font-mono text-xs font-medium text-ink/85 shrink-0">claude</span>
        <span className="font-mono text-xs text-ink/40 min-w-0 truncate">Running npm test…</span>
        <span className={`${METADATA_CHIP} ml-auto`}>lima</span>
      </div>
    </FloatingPanel>
  );
}

export function ScriptsMock() {
  return (
    <FloatingPanel divided>
      <ScriptRowView name="Dev server" command="npm run dev" />
      <ScriptRowView name="Test suite" command="npm test" />
    </FloatingPanel>
  );
}

export function HooksMock() {
  return (
    <FloatingPanel divided>
      <HookRowView
        label="Start"
        description="Task moves to In Progress"
        command={'claude "$OUIJIT_TASK_DESCRIPTION"'}
      />
      <HookRowView label="Review" description="Task moves to In Review" command="gh pr create --fill" />
    </FloatingPanel>
  );
}

export function ThemeMock() {
  return (
    <FloatingPanel>
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary">Theme</div>
          <div className="text-xs text-text-tertiary mt-0.5">System follows the OS appearance.</div>
        </div>
        <span className="w-[8.5rem] shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 text-sm bg-ink/[0.04] border border-ink/10 rounded-md text-text-primary">
          <span className="truncate">Dracula</span>
          <Icon name="caret-down" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        </span>
      </div>
    </FloatingPanel>
  );
}

export function TagsMock() {
  return (
    <FloatingPanel>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <StatusDot summaryType="ready" />
        <span className="font-mono text-xs font-medium text-ink/85 shrink-0">claude</span>
        <span className="inline-flex items-center gap-1 min-w-0">
          <span className={METADATA_CHIP}>frontend</span>
          <span className={METADATA_CHIP}>api</span>
        </span>
      </div>
    </FloatingPanel>
  );
}

export function ShortcutsMock() {
  return (
    <FloatingPanel>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[11px] text-ink/40">
        <KeyHint keys="⌘1–9" label="Jump to a terminal" />
        <KeyHint keys="⌘T" label="Board" />
        <KeyHint keys="⌘N" label="New task" />
        <KeyHint keys="⌘I" label="New terminal" />
      </div>
    </FloatingPanel>
  );
}

export function ResumeMock() {
  return (
    <FloatingPanel>
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm text-text-primary leading-tight">Resume last session</span>
          <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-text-tertiary">
            4 terminals across 2 tasks and 1 project
            <Icon name="caret-down" className="w-2.5 h-2.5 -rotate-90" />
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-3 py-1.5 text-xs text-text-secondary rounded-full">Dismiss</span>
          <span className="px-4 py-1.5 text-xs font-medium text-accent-ink bg-accent rounded-full">Resume</span>
        </div>
      </div>
    </FloatingPanel>
  );
}

export function CliMock() {
  return (
    <FloatingPanel>
      <div className="px-4 py-3 font-mono text-[12px] leading-relaxed">
        <div className="text-ink/85">
          <span className="text-accent">❯</span> ouijit task spawn &quot;Fix flaky auth test&quot; --hook-command
          claude
        </div>
        <div className="text-ink/45 truncate">
          {'{"success": true, "task": {"taskNumber": 12, "branch": "fix-flaky-auth-test-12"}}'}
        </div>
      </div>
    </FloatingPanel>
  );
}
