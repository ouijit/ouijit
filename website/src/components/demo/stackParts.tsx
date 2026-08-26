import type { ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { getPanelFixtures, type PanelFixtures } from './MockPanels';
import { FEATURES_BRANCHES, featuresTerminalsByTask } from './featuresFixtures';

/**
 * The static pieces of a terminal stack — card contents, panel tabs, and the
 * fixture terminals — shared by the workspace scene and the app window mock.
 * The terminals themselves come from featuresFixtures, which the board rows
 * and the palette also read, so a card and its row cannot say different things.
 */

export type PanelKind = 'plan' | 'preview' | 'diff';

export interface StackTerminal {
  ptyId: string;
  label: string;
  summaryType: string;
  lastOscTitle: string;
  branch?: string;
  sandboxed?: boolean;
  tags?: string[];
}

export const STACK_TERMINALS: StackTerminal[] = Object.values(featuresTerminalsByTask)
  .flat()
  .map((t) => ({
    ptyId: t.ptyId,
    label: t.label,
    summaryType: t.summaryType,
    lastOscTitle: t.lastOscTitle ?? '',
    branch: FEATURES_BRANCHES[t.ptyId],
  }));

/** Static branch chip mimicking the in-app BranchCopy without the interactive copy state. */
export function BranchLabel({ branch }: { branch: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-white/45 self-start shrink-0">
      <Icon name="git-branch" className="w-3 h-3 shrink-0 text-white/35" />
      <span className="truncate">{branch}</span>
    </span>
  );
}

/** Panel controls mirroring the app's joined beveled segmented control: a tab
 * per open panel (the markdown file, the preview host, the diff summary) plus a
 * + to add more. Each tab is controlled — clicking toggles the matching mock
 * panel for the active terminal, with the open tab highlighted. */
export function ActiveActions({
  fixtures,
  openPanel,
  onToggle,
}: {
  fixtures: PanelFixtures;
  openPanel: PanelKind | null;
  onToggle: (kind: PanelKind) => void;
}) {
  const base =
    'h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium transition-colors duration-150 ease-out';
  const inactive = 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary';
  const active = 'bg-accent text-accent-ink hover:bg-accent';
  const cls = (kind: PanelKind) => `${base} ${openPanel === kind ? active : inactive}`;
  const divider = <div aria-hidden className="w-px h-3 shrink-0 bg-ink/10 self-center" />;
  const diff = fixtures.diff;
  const diffAdds = diff?.files.reduce((s, f) => s + f.additions, 0) ?? 0;
  const diffDels = diff?.files.reduce((s, f) => s + f.deletions, 0) ?? 0;
  const handle = (kind: PanelKind) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(kind);
  };
  return (
    <div className="flex items-center min-w-0 h-7 bg-background-secondary glass-bevel relative border border-bezel rounded-[12px] overflow-hidden">
      {fixtures.plan && (
        <>
          <button className={cls('plan')} onClick={handle('plan')}>
            <Icon name="file-text" className="w-3.5 h-3.5" />
            <span>{fixtures.plan.filename}</span>
          </button>
          {divider}
        </>
      )}
      {fixtures.preview && (
        <>
          <button className={cls('preview')} onClick={handle('preview')}>
            <Icon name="globe-simple" className="w-3.5 h-3.5" />
            <span>{fixtures.preview.url.replace(/^https?:\/\//, '').split('/')[0]}</span>
          </button>
          {divider}
        </>
      )}
      {diff && diff.files.length > 0 && (
        <>
          <button className={cls('diff')} onClick={handle('diff')}>
            <span>
              {diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}
            </span>
            {diffAdds > 0 && <span className={openPanel === 'diff' ? '' : 'text-status-ready'}>+{diffAdds}</span>}
            {diffDels > 0 && <span className={openPanel === 'diff' ? '' : 'text-ansi-red'}>-{diffDels}</span>}
          </button>
          {divider}
        </>
      )}
      <button className={`${base} ${inactive} shrink-0 !px-2`} aria-label="Add panel">
        <Icon name="plus" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export const BODY_CLS = 'flex-1 p-4 font-mono text-[11px] leading-[1.65] text-white/85 overflow-hidden min-h-0 flex flex-col';

/* ─── Claude conversation atoms ──────────────────────────────────── */

export function ClaudeUser({ children }: { children: ReactNode }) {
  return (
    <div className="text-white/70">
      <span className="text-white/35 mr-2">&gt;</span>
      {children}
    </div>
  );
}

/** Claude Code's bullet-style tool call header: green `⏺` dot, white text. */
export function ToolCall({ name, args }: { name: string; args: ReactNode }) {
  return (
    <div className="mt-2 text-white/85">
      <span className="text-[#7ee787] mr-1.5">⏺</span>
      <span>{name}</span>
      <span className="text-white/45">(</span>
      <span>{args}</span>
      <span className="text-white/45">)</span>
    </div>
  );
}

/** Indented result body line (`  ⎿ ...`). */
export function ToolResult({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <div className={`pl-4 ${dim ? 'text-white/40' : 'text-white/55'}`}>
      <span className="text-white/30 mr-1.5">⎿</span>
      {children}
    </div>
  );
}

export function Continuation({ children, dim = true }: { children: ReactNode; dim?: boolean }) {
  return <div className={`pl-7 ${dim ? 'text-white/40' : 'text-white/55'}`}>{children}</div>;
}

/** A changed line as Claude Code prints it under an edit: number, sign, source.
 *  Shares the diff panel's tokens so the two surfaces agree on what an addition
 *  looks like. */
export type EditDiffRow = [number, '+' | '-' | ' ', string];

export function EditDiff({ rows }: { rows: EditDiffRow[] }) {
  const tone = (sign: EditDiffRow[1]) =>
    sign === '+'
      ? 'bg-diff-added/10 text-diff-added'
      : sign === '-'
        ? 'bg-diff-removed/[0.08] text-diff-removed'
        : 'text-white/40';
  return (
    <div className="pl-7 mt-0.5">
      {rows.map(([no, sign, content], i) => (
        <div key={i} className={`flex ${tone(sign)}`}>
          <span className="w-7 shrink-0 pr-2 text-right text-white/20 select-none">{no}</span>
          <span className="w-3 shrink-0 select-none">{sign === ' ' ? '' : sign}</span>
          <span className="truncate">{content}</span>
        </div>
      ))}
    </div>
  );
}

export function AssistantSay({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 text-white/85">
      <span className="text-white mr-1.5">⏺</span>
      {children}
    </div>
  );
}

/** The line Claude Code prints while a turn is still running. A busy card ends
 *  on this rather than on its last output, which reads as a session that has
 *  stopped rather than one mid-thought. */
export function WorkingLine({ verb, elapsed, tokens }: { verb: string; elapsed: string; tokens: string }) {
  return (
    <div className="mt-2 text-[#ff8c69]">
      <span className="tui-spinner mr-1.5" aria-hidden>
        <span>✻</span>
        <span>✽</span>
        <span>✳</span>
        <span>✶</span>
      </span>
      {verb}&hellip;
      <span className="ml-1.5 text-white/35">
        ({elapsed} · ↓ {tokens} tokens · esc to interrupt)
      </span>
    </div>
  );
}

/** The mode line and status row under the composer. Both shells on the site
 *  render this one, so the mode a mock advertises cannot differ by section. */
export function TuiStatus({ busy }: { busy?: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[10px]">
      <span className="text-[#e3b341]">⏵⏵ auto mode on</span>
      {/* esc to interrupt lives in the working line while a turn is running,
          which is where the real TUI puts it. */}
      <span className="text-white/35">· Opus 5 {busy ? '' : '· ⏎ to send '}· ↓ to manage</span>
    </div>
  );
}

/** Claude Code-style TUI input pinned to the bottom of the body. Two
 * horizontal rules with a `❯` prompt between them, followed by a status
 * line. The status line surfaces busy state inline ("esc to interrupt")
 * to match the real TUI. */
function ClaudeTuiInput({ busy = false, pendingText }: { busy?: boolean; pendingText?: string }) {
  return (
    <div className="shrink-0 mt-3">
      <div className="border-t border-white/15" />
      <div className="py-1.5 flex items-center gap-2">
        <span className="text-white/55">❯</span>
        <span className="flex-1 min-w-0 truncate text-white/85">
          {pendingText ?? <span className="text-white/25">Type a follow-up&hellip;</span>}
        </span>
      </div>
      <div className="border-t border-white/15" />
      <TuiStatus busy={busy} />
    </div>
  );
}

/** Wraps a Claude conversation: scrolling content area on top, TUI input
 * pinned at the bottom — matching the real Claude Code TUI layout. */
export function ClaudeShell({ children, busy, pendingText }: { children: ReactNode; busy?: boolean; pendingText?: string }) {
  return (
    <div className={BODY_CLS}>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      <ClaudeTuiInput busy={busy} pendingText={pendingText} />
    </div>
  );
}

/* ─── Bodies ─────────────────────────────────────────────────────── */

export function ClaudeBody() {
  return (
    <ClaudeShell busy>
      <ClaudeUser>Split onboarding into a three-step stepper with saved progress.</ClaudeUser>
      <AssistantSay>
        <span>I&rsquo;ll read the existing component first, then split it.</span>
      </AssistantSay>
      <ToolCall name="Read" args="src/onboarding/Stepper.tsx" />
      <ToolResult>Read 142 lines</ToolResult>
      <ToolCall name="Edit" args="src/onboarding/Stepper.tsx" />
      <ToolResult>
        <span className="text-[#3fb950]">+92</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−14</span>
        <span className="ml-2 text-white/55">lines</span>
      </ToolResult>
      <Continuation>persists progress, adds back affordance, retires WelcomeIntro</Continuation>
      <ToolCall name="Write" args="src/onboarding/useOnboardingProgress.ts" />
      <ToolResult>
        <span className="text-[#3fb950]">+38</span>
        <span className="ml-2 text-white/55">lines (new)</span>
      </ToolResult>
      <ToolCall name="Bash" args="npm test -- onboarding" />
      <ToolResult>
        <span className="text-[#3fb950]">PASS</span>
        <span className="ml-2 text-white/65">14 tests</span>
        <span className="ml-2 text-white/35">in 2.1s</span>
      </ToolResult>
      <WorkingLine verb="Prestidigitating" elapsed="3m 41s" tokens="12.6k" />
    </ClaudeShell>
  );
}

export function DevServerBody() {
  const Hmr = ({ time, path }: { time: string; path: string }) => (
    <div>
      <span className="text-white/30">{time}</span> <span className="text-[#79b8ff]/80">[vite]</span>{' '}
      <span className="text-[#a4d4ff]/85">hmr update</span> <span className="text-white/55">{path}</span>
    </div>
  );
  return (
    <div className={BODY_CLS}>
      <div className="flex-1 min-h-0">
        <div>
          <span className="text-[#a78bfa] font-semibold">VITE</span> <span className="text-white/45">v5.4.10</span>
          <span className="ml-3 text-white/35">ready in 412 ms</span>
        </div>
        <div className="mt-2">
          <span className="text-[#3fb950] mr-1.5">➜</span>
          <span className="text-white/85 mr-1">Local:</span>
          <span className="text-[#79b8ff]">http://localhost:5173/</span>
        </div>
        <div>
          <span className="text-[#3fb950] mr-1.5">➜</span>
          <span className="text-white/85 mr-1">Network:</span>
          <span className="text-white/45">use --host to expose</span>
        </div>
        <div>
          <span className="text-[#3fb950] mr-1.5">➜</span>
          <span className="text-white/45">press </span>
          <span className="text-white/65">h + enter</span>
          <span className="text-white/45"> to show help</span>
        </div>
        <div className="mt-3" />
        <Hmr time="14:32:18" path="/src/onboarding/Stepper.tsx" />
        <Hmr time="14:32:21" path="/src/onboarding/WelcomeIntro.tsx" />
        <Hmr time="14:32:24" path="/src/onboarding/Stepper.tsx" />
        <div>
          <span className="text-white/30">14:32:34</span> <span className="text-[#79b8ff]/80">[vite]</span>{' '}
          <span className="text-[#ffb454]/90">page reload</span>{' '}
          <span className="text-white/45">src/onboarding/useOnboardingProgress.ts (new file)</span>
        </div>
        <Hmr time="14:32:41" path="/src/onboarding/Stepper.tsx" />
      </div>
    </div>
  );
}

export function TestBody() {
  return (
    <ClaudeShell pendingText="run litmus on the new template">
      <ClaudeUser>Tighten the invitation email — subject line, brand tokens, plain-text fallback.</ClaudeUser>
      <AssistantSay>
        <span>I&rsquo;ll start with the templates dir to see the shape.</span>
      </AssistantSay>
      <ToolCall name="Read" args="app/mailers/templates/invitation.tsx" />
      <ToolResult>Read 86 lines</ToolResult>
      <ToolCall name="Edit" args="app/mailers/templates/invitation.tsx" />
      <ToolResult>
        <span className="text-[#3fb950]">+24</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−16</span>
        <span className="ml-2 text-white/55">lines</span>
      </ToolResult>
      <Continuation>tightens subject, drops inline colors, fixes plain-text fallback</Continuation>
      <ToolCall name="Edit" args="app/mailers/templates/styles.ts" />
      <ToolResult>
        <span className="text-[#3fb950]">+6</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−6</span>
        <span className="ml-2 text-white/55">lines · brand tokens</span>
      </ToolResult>
      <ToolCall name="Bash" args="npm test -- email" />
      <ToolResult>
        <span className="text-[#3fb950]">PASS</span>
        <span className="ml-2 text-white/65">14 tests</span>
        <span className="ml-2 text-white/35">in 1.1s</span>
      </ToolResult>
      <AssistantSay>
        <span>Subject is now 47 chars. Brand tokens applied. Want me to send a Litmus preview?</span>
      </AssistantSay>
    </ClaudeShell>
  );
}

export function ShellBody() {
  return (
    <ClaudeShell busy>
      <ClaudeUser>Audit the settings dialog for WCAG 2.0 AA issues and queue fixes.</ClaudeUser>
      <AssistantSay>
        <span>I&rsquo;ll run axe against the rendered dialog first.</span>
      </AssistantSay>
      <ToolCall name="Bash" args="npx @axe-core/cli http://localhost:5173/settings" />
      <ToolResult>
        <span className="text-[#3fb950]">38 passes</span>
        <span className="mx-1.5 text-white/30">·</span>
        <span className="text-[#ff6b6b]">2 violations</span>
        <span className="mx-1.5 text-white/30">·</span>
        <span className="text-white/55">4 incomplete</span>
      </ToolResult>
      <ToolCall name="Read" args="src/components/SettingsDialog.tsx" />
      <ToolResult>Read 187 lines</ToolResult>
      <AssistantSay>
        <span>aria-required-parent — tab buttons need a tablist parent. Patching.</span>
      </AssistantSay>
      <ToolCall name="Edit" args="src/components/SettingsDialog.tsx" />
      <ToolResult>
        <span className="text-[#3fb950]">+6</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−2</span>
        <span className="ml-2 text-white/55">lines · wraps tabs in role=tablist</span>
      </ToolResult>
      <AssistantSay>
        <span className="italic text-white/55">Investigating the contrast issue at line 121&hellip;</span>
      </AssistantSay>
      <WorkingLine verb="Puzzling" elapsed="5m 09s" tokens="18.3k" />
    </ClaudeShell>
  );
}

export function renderStaticBody(ptyId: string): ReactNode {
  switch (ptyId) {
    case 'pty-101-claude':
      return <ClaudeBody />;
    case 'pty-101-dev':
      return <DevServerBody />;
    case 'pty-103-test':
      return <TestBody />;
    case 'pty-105-shell':
      return <ShellBody />;
    default:
      return null;
  }
}

export { getPanelFixtures };
