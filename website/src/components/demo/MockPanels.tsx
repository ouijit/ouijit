import { useState, type ReactNode } from 'react';
import { Icon } from '@app/components/terminal/Icon';

/* ─── Plan ────────────────────────────────────────────────────────── */

interface PlanFixture {
  filename: string;
  body: ReactNode;
}

interface DiffFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | '?';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldNo?: number;
  newNo?: number;
}

interface DiffFixture {
  files: DiffFile[];
  branchAhead?: string;
}

interface PreviewFixture {
  url: string;
  /** Rendered content shown inside the fake browser viewport. */
  page: ReactNode;
}

export interface PanelFixtures {
  plan?: PlanFixture;
  diff?: DiffFixture;
  preview?: PreviewFixture;
}

/* ─── Per-terminal fixtures ───────────────────────────────────────── */

const ONBOARDING_PLAN_BODY: ReactNode = (
  <>
    <h1>Rework onboarding flow</h1>
    <p>
      Split the onboarding into a three-step stepper so that users can leave and resume without losing progress, and so
      we can drop the legacy <code>WelcomeIntro</code> wall of text.
    </p>
    <h2>Steps</h2>
    <ul>
      <li>
        <input type="checkbox" checked readOnly /> Sketch the new stepper shell in{' '}
        <code>src/onboarding/Stepper.tsx</code>
      </li>
      <li>
        <input type="checkbox" checked readOnly /> Persist progress per-account via the{' '}
        <code>useOnboardingProgress</code> hook
      </li>
      <li>
        <input type="checkbox" readOnly /> Move <code>WelcomeIntro</code> copy into a single intro step and retire the
        old screen
      </li>
      <li>
        <input type="checkbox" readOnly /> Wire the &ldquo;back&rdquo; affordance on every step except the first
      </li>
      <li>
        <input type="checkbox" readOnly /> Update the integration test in <code>onboarding.test.tsx</code>
      </li>
    </ul>
    <h2>Notes</h2>
    <p>
      Saved progress lives on the user record, not in <code>localStorage</code>, so signing in on a fresh device picks
      up where the previous one left off. The hook reads/writes via the existing <code>account.preferences</code>{' '}
      column.
    </p>
    <blockquote>
      <p>
        Don&rsquo;t reuse the legal-consent dialog from billing here. The product team wants the onboarding to feel
        like its own surface, not a pop-up.
      </p>
    </blockquote>
  </>
);

const TWO_FA_PLAN_BODY: ReactNode = (
  <>
    <h1>Add two-factor authentication</h1>
    <p>
      Add TOTP-based 2FA with downloadable recovery codes. The session model already stores a per-device fingerprint;
      the new column extends it with an opt-in <code>otpSecret</code>.
    </p>
    <h2>Steps</h2>
    <ul>
      <li>
        <input type="checkbox" readOnly /> Add <code>otpSecret</code> + <code>otpEnabledAt</code> to the user table
      </li>
      <li>
        <input type="checkbox" readOnly /> Generate and verify TOTP codes via <code>otplib</code>
      </li>
      <li>
        <input type="checkbox" readOnly /> Render a setup screen with QR + manual entry fallback
      </li>
      <li>
        <input type="checkbox" readOnly /> Generate ten recovery codes, render once, hash before storage
      </li>
      <li>
        <input type="checkbox" readOnly /> Gate session refresh on a successful TOTP if 2FA is enabled
      </li>
    </ul>
  </>
);

const INVITATION_PLAN_BODY: ReactNode = (
  <>
    <h1>Polish invitation email</h1>
    <p>
      Bring the invitation email in line with the rest of the transactional templates. Subject line, body, and
      plain-text fallback all needed an editor pass and a design-token sweep.
    </p>
    <ul>
      <li>
        <input type="checkbox" checked readOnly /> Tighten the subject line to under 60 characters
      </li>
      <li>
        <input type="checkbox" checked readOnly /> Replace ad-hoc colors with <code>--brand-*</code> tokens
      </li>
      <li>
        <input type="checkbox" checked readOnly /> Refresh the plain-text fallback so it actually scans
      </li>
      <li>
        <input type="checkbox" readOnly /> Send through Litmus once design signs off
      </li>
    </ul>
  </>
);

const ONBOARDING_DIFF: DiffFixture = {
  branchAhead: 'rework-onboarding',
  files: [
    {
      path: 'src/onboarding/Stepper.tsx',
      status: 'M',
      additions: 92,
      deletions: 14,
      hunks: [
        {
          header: '@@ -1,8 +1,12 @@ Stepper container',
          lines: [
            { type: 'context', content: "import { useEffect, useState } from 'react';", oldNo: 1, newNo: 1 },
            { type: 'context', content: "import { Step } from './Step';", oldNo: 2, newNo: 2 },
            {
              type: 'addition',
              content: "import { useOnboardingProgress } from './useOnboardingProgress';",
              newNo: 3,
            },
            { type: 'context', content: '', oldNo: 3, newNo: 4 },
            { type: 'deletion', content: 'export function Stepper() {', oldNo: 4 },
            { type: 'addition', content: 'export function Stepper({ accountId }: { accountId: string }) {', newNo: 5 },
            { type: 'deletion', content: '  const [step, setStep] = useState(0);', oldNo: 5 },
            { type: 'addition', content: '  const { step, setStep } = useOnboardingProgress(accountId);', newNo: 6 },
            { type: 'context', content: '  const total = 3;', oldNo: 6, newNo: 7 },
            { type: 'context', content: '', oldNo: 7, newNo: 8 },
            { type: 'context', content: '  return (', oldNo: 8, newNo: 9 },
          ],
        },
      ],
    },
    {
      path: 'src/onboarding/useOnboardingProgress.ts',
      status: 'A',
      additions: 38,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,38 @@',
          lines: [
            { type: 'addition', content: "import { useEffect, useState } from 'react';", newNo: 1 },
            { type: 'addition', content: "import { api } from '../api';", newNo: 2 },
            { type: 'addition', content: '', newNo: 3 },
            { type: 'addition', content: 'export function useOnboardingProgress(accountId: string) {', newNo: 4 },
            { type: 'addition', content: '  const [step, setStepState] = useState(0);', newNo: 5 },
            { type: 'addition', content: '', newNo: 6 },
            { type: 'addition', content: '  useEffect(() => {', newNo: 7 },
            { type: 'addition', content: '    api.preferences.get(accountId).then((p) => {', newNo: 8 },
            { type: 'addition', content: '      setStepState(p.onboardingStep ?? 0);', newNo: 9 },
            { type: 'addition', content: '    });', newNo: 10 },
            { type: 'addition', content: '  }, [accountId]);', newNo: 11 },
          ],
        },
      ],
    },
    {
      path: 'src/onboarding/WelcomeIntro.tsx',
      status: 'D',
      additions: 0,
      deletions: 64,
      hunks: [],
    },
  ],
};

const INVITATION_DIFF: DiffFixture = {
  branchAhead: 'polish-invitation-email',
  files: [
    {
      path: 'app/mailers/templates/invitation.tsx',
      status: 'M',
      additions: 24,
      deletions: 16,
      hunks: [
        {
          header: '@@ -12,10 +12,12 @@ Subject + heading',
          lines: [
            {
              type: 'deletion',
              content: "  subject: `${inviter.name} added you to ${workspace.name} on Constellation`,",
              oldNo: 12,
            },
            { type: 'addition', content: '  subject: `${inviter.name} invited you to ${workspace.name}`,', newNo: 12 },
            { type: 'context', content: '  preview: `Open the link below to join.`,', oldNo: 13, newNo: 13 },
            { type: 'context', content: '', oldNo: 14, newNo: 14 },
            {
              type: 'deletion',
              content: '  body: <Card style={{ background: "#0e1729", color: "#e7eaf6" }}>',
              oldNo: 15,
            },
            { type: 'addition', content: '  body: <Card>', newNo: 15 },
            { type: 'context', content: '    <Heading>You’ve been invited</Heading>', oldNo: 16, newNo: 16 },
          ],
        },
      ],
    },
    {
      path: 'app/mailers/templates/styles.ts',
      status: 'M',
      additions: 6,
      deletions: 6,
      hunks: [
        {
          header: '@@ -3,8 +3,8 @@ token map',
          lines: [
            { type: 'context', content: 'export const tokens = {', oldNo: 3, newNo: 3 },
            { type: 'deletion', content: "  primary: '#0e1729',", oldNo: 4 },
            { type: 'addition', content: "  primary: 'var(--brand-ink)',", newNo: 4 },
            { type: 'deletion', content: "  accent: '#e7eaf6',", oldNo: 5 },
            { type: 'addition', content: "  accent: 'var(--brand-paper)',", newNo: 5 },
            { type: 'context', content: '};', oldNo: 6, newNo: 6 },
          ],
        },
      ],
    },
  ],
};

const ONBOARDING_PREVIEW: PreviewFixture = {
  url: 'http://localhost:5173/onboarding',
  page: <OnboardingPreviewPage />,
};

const FIXTURES: Record<string, PanelFixtures> = {
  'pty-101-claude': {
    plan: { filename: 'plan.md', body: ONBOARDING_PLAN_BODY },
    diff: ONBOARDING_DIFF,
  },
  'pty-101-dev': {
    plan: { filename: 'plan.md', body: ONBOARDING_PLAN_BODY },
    diff: ONBOARDING_DIFF,
    preview: ONBOARDING_PREVIEW,
  },
  'pty-103-test': {
    plan: { filename: 'invitation-polish.md', body: INVITATION_PLAN_BODY },
    diff: INVITATION_DIFF,
  },
  'pty-105-shell': {
    diff: { branchAhead: 'main', files: [] },
  },
  'pty-142-claude': {
    plan: { filename: '2fa-plan.md', body: TWO_FA_PLAN_BODY },
  },
};

export function getPanelFixtures(ptyId: string): PanelFixtures {
  return FIXTURES[ptyId] ?? {};
}

/* ─── Shared chrome ───────────────────────────────────────────────── */

const PANEL_CHROME =
  'flex flex-col absolute inset-0 bg-[var(--color-terminal-bg,#171717)] border-l-0 border-t border-white/10';

interface PanelHeaderProps {
  icon: string;
  title: string;
  onClose: () => void;
  trailing?: ReactNode;
}

function PanelHeader({ icon, title, onClose, trailing }: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-white/10 shrink-0">
      <Icon name={icon} className="w-3.5 h-3.5 text-white/50 shrink-0" />
      <span className="text-[13px] text-white/50 truncate flex-1 font-mono">{title}</span>
      {trailing}
      <PanelHeaderButton aria-label="Split view">
        <Icon name="square-split-horizontal" className="w-3.5 h-3.5" />
      </PanelHeaderButton>
      <PanelHeaderButton aria-label="Minimize" onClick={onClose}>
        <Icon name="minus" className="w-4 h-4" />
      </PanelHeaderButton>
    </div>
  );
}

function PanelHeaderButton({
  children,
  onClick,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
}) {
  return (
    <button
      {...rest}
      className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

/* ─── Plan panel ──────────────────────────────────────────────────── */

export function MockPlanPanel({ fixture, onClose }: { fixture: PlanFixture; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={PANEL_CHROME}>
      <PanelHeader
        icon="list-checks"
        title={fixture.filename}
        onClose={onClose}
        trailing={
          <PanelHeaderButton
            aria-label={copied ? 'Copied' : 'Copy'}
            onClick={() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Icon
              name={copied ? 'check' : 'clipboard-text'}
              className={`w-3.5 h-3.5 ${copied ? 'text-[#69db7c]' : ''}`}
            />
          </PanelHeaderButton>
        }
      />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="plan-markdown">{fixture.body}</div>
      </div>
    </div>
  );
}

/* ─── Preview panel ───────────────────────────────────────────────── */

export function MockPreviewPanel({ fixture, onClose }: { fixture: PreviewFixture; onClose: () => void }) {
  return (
    <div className={PANEL_CHROME}>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-white/10 shrink-0">
        <Icon name="globe-simple" className="w-3.5 h-3.5 text-white/50 shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1 rounded-md bg-black/30 border border-white/10">
          <span className="text-[11px] font-mono text-white/35">https://</span>
          <span className="text-[11px] font-mono text-white/85 truncate">
            {fixture.url.replace(/^https?:\/\//, '')}
          </span>
        </div>
        <PanelHeaderButton aria-label="Reload">
          <Icon name="arrow-clockwise" className="w-3.5 h-3.5" />
        </PanelHeaderButton>
        <PanelHeaderButton aria-label="Open externally">
          <Icon name="arrow-square-out" className="w-3.5 h-3.5" />
        </PanelHeaderButton>
        <PanelHeaderButton aria-label="Minimize" onClick={onClose}>
          <Icon name="minus" className="w-4 h-4" />
        </PanelHeaderButton>
      </div>
      <div className="flex-1 overflow-hidden bg-white">{fixture.page}</div>
    </div>
  );
}

function OnboardingPreviewPage() {
  return (
    <div className="w-full h-full flex flex-col bg-[#fafafa] text-[#0a0a0c] font-sans overflow-hidden">
      <div className="px-6 py-3 border-b border-black/10 flex items-center gap-3">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#0a84ff] to-[#5ac8fa]" />
        <span className="text-[12px] font-medium">Constellation</span>
        <div className="ml-auto text-[11px] text-black/40">Step 2 of 3</div>
      </div>
      <div className="flex-1 flex flex-col items-center px-8 pt-6 pb-3 overflow-hidden min-h-0">
        <div className="text-[15px] font-semibold mb-1">Pick a workspace name</div>
        <div className="text-[11px] text-black/55 mb-4">You can change this later in settings.</div>
        <div className="w-full max-w-[320px] flex flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-black/45 mb-1">Workspace name</div>
            <div className="px-2.5 py-1.5 rounded border border-[#0a84ff]/60 bg-white text-[12px] shadow-[0_0_0_3px_rgba(10,132,255,0.15)]">
              Northwind
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-black/45 mb-1">Subdomain</div>
            <div className="flex items-center px-2.5 py-1.5 rounded border border-black/15 bg-white text-[12px] gap-1">
              <span className="text-black/85">northwind</span>
              <span className="text-black/40">.constellation.app</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <button className="px-3 py-1.5 rounded text-[11px] text-black/60 bg-transparent border border-black/15">
              Back
            </button>
            <button className="px-3 py-1.5 rounded text-[11px] text-white bg-[#0a84ff] border-none">Continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Diff panel ──────────────────────────────────────────────────── */

export function MockDiffPanel({ fixture, onClose }: { fixture: DiffFixture; onClose: () => void }) {
  const totalAdds = fixture.files.reduce((s, f) => s + f.additions, 0);
  const totalDels = fixture.files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className={PANEL_CHROME}>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-white/10 shrink-0">
        <Icon name="git-branch" className="w-3.5 h-3.5 text-white/50 shrink-0" />
        <span className="text-[13px] text-white/70 font-mono truncate">
          {fixture.branchAhead ?? 'uncommitted changes'}
        </span>
        <span className="text-[11px] text-white/40">
          {fixture.files.length} {fixture.files.length === 1 ? 'file' : 'files'}
        </span>
        {totalAdds > 0 && <span className="text-[11px] font-mono text-[#3fb950]">+{totalAdds}</span>}
        {totalDels > 0 && <span className="text-[11px] font-mono text-[#f85149]">-{totalDels}</span>}
        <div className="flex-1" />
        <PanelHeaderButton aria-label="Minimize" onClick={onClose}>
          <Icon name="minus" className="w-4 h-4" />
        </PanelHeaderButton>
      </div>
      {fixture.files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-[12px]">
          No changes on this branch yet.
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <DiffFileList files={fixture.files} />
          <div className="flex-1 overflow-auto min-w-0">
            {fixture.files.map((file) => (
              <DiffFileSection key={file.path} file={file} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffFileList({ files }: { files: DiffFile[] }) {
  return (
    <div className="w-[180px] border-r border-white/[0.06] shrink-0 overflow-y-auto py-1.5">
      {files.map((file) => {
        const name = file.path.split('/').pop() ?? file.path;
        return (
          <div
            key={file.path}
            className="flex items-center gap-1.5 py-1 pl-3 pr-2 text-[12px] text-white/75 hover:bg-white/5"
          >
            <Icon
              name={statusIcon(file.status)}
              className={`w-3.5 h-3.5 ${statusColor(file.status)}`}
            />
            <span className="flex-1 min-w-0 truncate" title={file.path}>
              {name}
            </span>
            {file.additions > 0 && <span className="font-mono text-[11px] text-[#3fb950]">+{file.additions}</span>}
            {file.deletions > 0 && <span className="font-mono text-[11px] text-[#f85149]">-{file.deletions}</span>}
          </div>
        );
      })}
    </div>
  );
}

function DiffFileSection({ file }: { file: DiffFile }) {
  return (
    <div className="border-b border-white/[0.08] last:border-b-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-[#252525] border-b border-white/[0.06]">
        <span className="flex-1 min-w-0 truncate text-[12px] text-white/90 font-mono">{file.path}</span>
        <span className={`shrink-0 text-[10px] px-1.5 py-px rounded font-medium ${statusBadge(file.status)}`}>
          {statusLabel(file.status)}
        </span>
        {file.additions > 0 && <span className="font-mono text-[11px] text-[#3fb950]">+{file.additions}</span>}
        {file.deletions > 0 && <span className="font-mono text-[11px] text-[#f85149]">-{file.deletions}</span>}
      </div>
      {file.hunks.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-white/35">File deleted</div>
      ) : (
        file.hunks.map((hunk, i) => (
          <div key={i}>
            <div
              className="py-0.5 pr-3 bg-[rgba(88,86,214,0.10)] text-[#8b8bcd] font-mono text-[11px] truncate"
              style={{ paddingLeft: 86 }}
            >
              {hunk.header}
            </div>
            {hunk.lines.map((line, j) => (
              <DiffLineRow key={j} line={line} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const lineBg =
    line.type === 'addition'
      ? 'bg-[rgba(63,185,80,0.10)]'
      : line.type === 'deletion'
        ? 'bg-[rgba(248,81,73,0.08)]'
        : '';
  const gutterBg =
    line.type === 'addition'
      ? 'bg-[rgba(63,185,80,0.12)]'
      : line.type === 'deletion'
        ? 'bg-[rgba(248,81,73,0.10)]'
        : 'bg-[#141414]';
  const prefix = line.type === 'context' ? ' ' : line.type === 'addition' ? '+' : '-';
  const prefixColor =
    line.type === 'addition' ? 'text-[#3fb950]' : line.type === 'deletion' ? 'text-[#f85149]' : 'text-transparent';
  return (
    <div className={`flex font-mono text-[11px] leading-5 ${lineBg}`}>
      <span className="flex shrink-0 select-none">
        <span className={`w-[36px] px-1.5 text-right text-white/25 ${gutterBg} border-r border-white/5`}>
          {line.oldNo ?? ''}
        </span>
        <span className={`w-[36px] px-1.5 text-right text-white/25 ${gutterBg} border-r border-white/5`}>
          {line.newNo ?? ''}
        </span>
      </span>
      <span className="flex-1 pl-2 pr-4 whitespace-pre-wrap break-words text-[#e6edf3]">
        <span className={`inline-block w-3 select-none ${prefixColor}`}>{prefix}</span>
        {line.content}
      </span>
    </div>
  );
}

function statusIcon(s: DiffFile['status']): string {
  switch (s) {
    case 'A':
    case '?':
      return 'file-plus';
    case 'D':
      return 'file-minus';
    case 'R':
      return 'file-text';
    default:
      return 'file-dashed';
  }
}

function statusColor(s: DiffFile['status']): string {
  switch (s) {
    case 'A':
      return 'text-[#34C759]';
    case 'D':
      return 'text-[#FF3B30]';
    case 'R':
      return 'text-[#5856D6]';
    case '?':
      return 'text-[#FF9F0A]';
    default:
      return 'text-white/50';
  }
}

function statusBadge(s: DiffFile['status']): string {
  switch (s) {
    case 'A':
      return 'bg-[#34C759]/15 text-[#34C759]';
    case 'D':
      return 'bg-[#FF3B30]/15 text-[#FF3B30]';
    case 'R':
      return 'bg-[#5856D6]/15 text-[#5856D6]';
    case '?':
      return 'bg-[#FF9F0A]/15 text-[#FF9F0A]';
    default:
      return 'bg-white/[0.06] text-white/55';
  }
}

function statusLabel(s: DiffFile['status']): string {
  switch (s) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case '?':
      return 'untracked';
    default:
      return 'modified';
  }
}
