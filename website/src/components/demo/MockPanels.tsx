import { useState, type ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';

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

const REACT_19_PLAN_BODY: ReactNode = (
  <>
    <h1>Migrate to React 19</h1>
    <p>
      Bring the app onto React 19. Order matters here — codemod and dep bumps first so the type-check passes,
      then Suspense + transitions in their own focused passes so we don&rsquo;t conflate diff noise with semantic
      changes.
    </p>
    <h2>Steps</h2>
    <ul>
      <li>
        <input type="checkbox" readOnly /> Pin <code>react</code> and <code>react-dom</code> to{' '}
        <code>19.0.0</code>; bump <code>@testing-library/react</code> to 16
      </li>
      <li>
        <input type="checkbox" readOnly /> Run <code>types-react-codemod preset-19</code> across <code>src/</code>{' '}
        and review the noisy ref-type changes
      </li>
      <li>
        <input type="checkbox" readOnly /> Push remaining work into two subtasks: Suspense boundaries,{' '}
        <code>useTransition</code> audit
      </li>
      <li>
        <input type="checkbox" readOnly /> Move parent task to <code>in_review</code> once codemod lands and the
        subtasks are queued
      </li>
    </ul>
    <h2>Subtasks</h2>
    <p>
      Each subtask gets its own worktree so the codemod, Suspense rewrite, and transitions audit can be reviewed
      independently and merged in any order.
    </p>
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

const REACT_19_DIFF: DiffFixture = {
  branchAhead: 'migrate-react-19',
  files: [
    {
      path: 'package.json',
      status: 'M',
      additions: 2,
      deletions: 2,
      hunks: [
        {
          header: '@@ -22,8 +22,8 @@ "dependencies"',
          lines: [
            { type: 'context', content: '  "dependencies": {', oldNo: 22, newNo: 22 },
            { type: 'context', content: '    "@tanstack/react-query": "^5.59.0",', oldNo: 23, newNo: 23 },
            { type: 'deletion', content: '    "react": "18.3.1",', oldNo: 24 },
            { type: 'deletion', content: '    "react-dom": "18.3.1",', oldNo: 25 },
            { type: 'addition', content: '    "react": "19.0.0",', newNo: 24 },
            { type: 'addition', content: '    "react-dom": "19.0.0",', newNo: 25 },
            { type: 'context', content: '    "zustand": "^5.0.1"', oldNo: 26, newNo: 26 },
            { type: 'context', content: '  },', oldNo: 27, newNo: 27 },
          ],
        },
      ],
    },
    {
      path: 'src/components/Settings.tsx',
      status: 'M',
      additions: 4,
      deletions: 4,
      hunks: [
        {
          header: '@@ -8,12 +8,12 @@ ref types',
          lines: [
            { type: 'context', content: 'import { forwardRef } from "react";', oldNo: 8, newNo: 8 },
            { type: 'context', content: '', oldNo: 9, newNo: 9 },
            { type: 'deletion', content: 'export const Settings = forwardRef<HTMLDivElement, Props>(', oldNo: 10 },
            { type: 'deletion', content: '  function Settings(props, ref) {', oldNo: 11 },
            { type: 'addition', content: 'export function Settings(props: Props) {', newNo: 10 },
            { type: 'addition', content: '  const { ref, ...rest } = props;', newNo: 11 },
            { type: 'context', content: '    return (', oldNo: 12, newNo: 12 },
            { type: 'context', content: '      <div ref={ref} className="settings">', oldNo: 13, newNo: 13 },
          ],
        },
      ],
    },
    {
      path: 'src/types/refs.d.ts',
      status: 'D',
      additions: 0,
      deletions: 12,
      hunks: [],
    },
  ],
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
    plan: { filename: 'plan.md', body: REACT_19_PLAN_BODY },
    diff: REACT_19_DIFF,
  },
};

export function getPanelFixtures(ptyId: string): PanelFixtures {
  return FIXTURES[ptyId] ?? {};
}

/* ─── Shared chrome ───────────────────────────────────────────────── */

// Panels are flush panes: they fill the card body edge to edge and let the
// card's own rounding clip their corners, exactly like the app's panel slot.
const PANEL_CHROME = 'flex flex-col absolute inset-0 overflow-hidden bg-terminal-bg';

const PANEL_HEADER_BUTTON =
  'w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-ink/60 shrink-0 transition-all duration-150 ease-out hover:bg-ink/10 hover:text-ink/90 [&>svg]:w-3.5 [&>svg]:h-3.5';

interface PanelHeaderProps {
  icon: string;
  title: string;
  onClose: () => void;
  trailing?: ReactNode;
}

function PanelHeader({ icon, title, onClose, trailing }: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 shrink-0">
      <Icon name={icon} className="w-3.5 h-3.5 text-ink/50 shrink-0" />
      <span className="text-[13px] text-ink/50 truncate flex-1 font-mono">{title}</span>
      {trailing}
      <PanelHeaderButton aria-label="Split view">
        <Icon name="square-split-horizontal" />
      </PanelHeaderButton>
      <PanelHeaderButton aria-label="Minimize" onClick={onClose}>
        <Icon name="minus" className="!w-4 !h-4" />
      </PanelHeaderButton>
      <PanelHeaderButton aria-label="Close" onClick={onClose}>
        <Icon name="x" />
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
      className={PANEL_HEADER_BUTTON}
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
        icon="file-text"
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
            <Icon name={copied ? 'check' : 'clipboard-text'} className={copied ? 'text-ansi-green' : ''} />
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
      <div className="flex items-center gap-1 px-2 py-1.5 shrink-0">
        <span className={`${PANEL_HEADER_BUTTON} !text-ink/20`} aria-hidden="true">
          <Icon name="arrow-left" />
        </span>
        <span className={`${PANEL_HEADER_BUTTON} !text-ink/20`} aria-hidden="true">
          <Icon name="arrow-right" />
        </span>
        <PanelHeaderButton aria-label="Reload">
          <Icon name="arrows-clockwise" />
        </PanelHeaderButton>
        <span className="text-[13px] text-ink/60 truncate flex-1 min-w-0 font-mono py-0.5 px-2">
          {fixture.url.replace(/^https?:\/\//, '')}
        </span>
        <PanelHeaderButton aria-label="Split view">
          <Icon name="square-split-horizontal" />
        </PanelHeaderButton>
        <PanelHeaderButton aria-label="Minimize" onClick={onClose}>
          <Icon name="minus" className="!w-4 !h-4" />
        </PanelHeaderButton>
        <PanelHeaderButton aria-label="Close" onClick={onClose}>
          <Icon name="x" />
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
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-accent to-[#9af0c0]" />
        <span className="text-[12px] font-medium">Constellation</span>
        <div className="ml-auto text-[11px] text-black/40">Step 2 of 3</div>
      </div>
      <div className="flex-1 flex flex-col items-center px-8 pt-6 pb-3 overflow-hidden min-h-0">
        <div className="text-[15px] font-semibold mb-1">Pick a workspace name</div>
        <div className="text-[11px] text-black/55 mb-4">You can change this later in settings.</div>
        <div className="w-full max-w-[320px] flex flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-black/45 mb-1">Workspace name</div>
            <div className="px-2.5 py-1.5 rounded border border-accent/60 bg-white text-[12px] ring-[3px] ring-accent/15">
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
            <button className="px-3 py-1.5 rounded text-[11px] text-accent-ink bg-accent border-none">Continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Diff panel ──────────────────────────────────────────────────── */

export function MockDiffPanel({
  fixture,
  compact = false,
  onClose,
}: {
  fixture: DiffFixture;
  /** Split view: the file tree stays collapsed so the diff keeps its width. */
  compact?: boolean;
  onClose: () => void;
}) {
  const totalAdds = fixture.files.reduce((s, f) => s + f.additions, 0);
  const totalDels = fixture.files.reduce((s, f) => s + f.deletions, 0);
  const count = fixture.files.length;
  let stats = `${count} file${count !== 1 ? 's' : ''}`;
  if (totalAdds > 0) stats += ` +${totalAdds}`;
  if (totalDels > 0) stats += ` -${totalDels}`;

  return (
    <div className={`${PANEL_CHROME} !flex-row`}>
      {count > 0 && !compact && (
        <>
          <div className="shrink-0 overflow-y-auto py-2" style={{ width: 200 }}>
            {fixture.files.map((file) => {
              const name = file.path.split('/').pop() ?? file.path;
              return (
                <div
                  key={file.path}
                  className="flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] transition-colors duration-150 ease-out hover:bg-ink/5 text-text-secondary"
                  title={file.path}
                >
                  <Icon name={statusIcon(file.status)} className={`w-4 h-4 ${statusColor(file.status)}`} />
                  <span className="flex-1 min-w-0 truncate">{name}</span>
                  <span className="shrink-0 font-mono text-[13px]">
                    {file.additions > 0 && <span className="text-diff-added">+{file.additions}</span>}
                    {file.additions > 0 && file.deletions > 0 && ' '}
                    {file.deletions > 0 && <span className="text-diff-removed">-{file.deletions}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pane-seam relative w-px shrink-0" />
        </>
      )}
      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="pane-ledge over-well relative z-30 px-3 py-2 text-sm text-ink/70 flex items-center gap-2 shrink-0">
          <PanelHeaderButton aria-label="Hide the file list">
            <Icon name="sidebar-simple" />
          </PanelHeaderButton>
          <span className="flex items-center gap-1 font-mono text-[13px] text-ink/70">
            <Icon name="git-branch" className="w-3.5 h-3.5 text-ink/45" />
            {fixture.branchAhead ?? 'main'}
            <Icon name="caret-down" className="!w-3 !h-3 text-ink/40" />
          </span>
          <span className="ml-auto min-w-0 truncate text-xs text-text-tertiary">{stats}</span>
          <PanelHeaderButton aria-label="Split view">
            <Icon name="square-split-horizontal" />
          </PanelHeaderButton>
          <PanelHeaderButton aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </PanelHeaderButton>
        </div>
        <div className="diff-well diff-list flex-1 overflow-auto pb-3">
          {count === 0 ? (
            <div className="flex-1 h-full flex flex-col items-center justify-center text-text-tertiary gap-2">
              No changes
            </div>
          ) : (
            fixture.files.map((file) => <DiffFileCard key={file.path} file={file} />)
          )}
        </div>
      </div>
    </div>
  );
}

function DiffFileCard({ file }: { file: DiffFile }) {
  const cut = file.path.lastIndexOf('/');
  const dir = cut === -1 ? '' : file.path.slice(0, cut + 1);
  const base = cut === -1 ? file.path : file.path.slice(cut + 1);
  return (
    <div className="diff-card mx-6 rounded-[14px] border border-bezel bg-diff-card overflow-clip">
      <div className="pane-ledge sticky top-0 z-10 flex items-center gap-2 px-4 h-9 bg-terminal-surface">
        <span
          className="shrink-0 w-4 h-4 rounded border border-ink/25 text-transparent flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3"
          aria-hidden="true"
        >
          <Icon name="check" />
        </span>
        <span className="flex-1 min-w-0 truncate font-mono text-[13px]" title={file.path}>
          <span className="text-ink/35">{dir}</span>
          <span className="text-ink/90">{base}</span>
        </span>
        <span className={`shrink-0 text-[10px] px-1 py-px rounded font-medium ${statusBadge(file.status)}`}>
          {statusLabel(file.status)}
        </span>
        <span className="shrink-0 font-mono text-[11px]">
          {file.additions > 0 && <span className="text-diff-added">+{file.additions}</span>}
          {file.additions > 0 && file.deletions > 0 && ' '}
          {file.deletions > 0 && <span className="text-diff-removed">-{file.deletions}</span>}
        </span>
      </div>
      {file.hunks.length === 0 ? (
        <div className="px-4 py-6 text-center font-mono text-[11px] text-text-tertiary">File deleted</div>
      ) : (
        file.hunks.map((hunk, i) => (
          <div key={i}>
            <HunkHeader header={hunk.header} first={i === 0} />
            {hunk.lines.map((line, j) => (
              <DiffLineRow key={j} line={line} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function HunkHeader({ header, first }: { header: string; first: boolean }) {
  const match = /^(@@[^@]*@@)\s*(.*)$/.exec(header);
  const range = match?.[1] ?? header;
  const context = match?.[2] ?? '';
  return (
    <div
      className={`flex items-center gap-3 py-1 pr-4 font-mono text-xs ${first ? '' : 'border-t border-ink/[0.06]'}`}
      style={{ paddingLeft: '100px' }}
    >
      <span className="shrink-0 text-ink/25">{range}</span>
      {context && <span className="truncate text-ink/45">{context}</span>}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const lineBg =
    line.type === 'addition' ? 'bg-diff-added/10' : line.type === 'deletion' ? 'bg-diff-removed/[0.08]' : '';
  const gutterBg =
    line.type === 'addition'
      ? 'bg-diff-added/[0.12]'
      : line.type === 'deletion'
        ? 'bg-diff-removed/10'
        : 'bg-terminal-inset';
  const prefixColor =
    line.type === 'addition' ? 'text-diff-added' : line.type === 'deletion' ? 'text-diff-removed' : 'text-transparent';
  return (
    <div className={`relative flex font-mono text-sm leading-normal ${lineBg}`}>
      <span className={`flex shrink-0 select-none sticky left-0 z-[1] ${gutterBg} border-r border-ink/[0.07]`}>
        <span className="w-[44px] px-2 text-right text-ink/25">{line.oldNo ?? ''}</span>
        <span className="w-[44px] px-2 text-right text-ink/25">{line.newNo ?? ''}</span>
      </span>
      <span className="flex-1 pl-2 pr-12 whitespace-pre-wrap break-words">
        <span className={`inline-block w-4 select-none ${prefixColor}`}>
          {line.type === 'context' ? ' ' : line.type === 'addition' ? '+' : '-'}
        </span>
        <span className="text-diff-fg">{line.content}</span>
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
      return 'text-vcs-added';
    case 'D':
      return 'text-vcs-deleted';
    case 'R':
      return 'text-vcs-renamed';
    case '?':
      return 'text-vcs-modified';
    default:
      return 'text-ink/50';
  }
}

function statusBadge(s: DiffFile['status']): string {
  switch (s) {
    case 'A':
      return 'bg-vcs-added/15 text-vcs-added';
    case 'D':
      return 'bg-vcs-deleted/15 text-vcs-deleted';
    case 'R':
      return 'bg-vcs-renamed/15 text-vcs-renamed';
    case '?':
      return 'bg-vcs-modified/15 text-vcs-modified';
    default:
      return 'bg-ink/[0.06] text-ink/40';
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
