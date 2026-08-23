import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { MockPullRequests } from './MockPullRequests';
import { MockPreviewPanel, getPanelFixtures } from './MockPanels';
import {
  ActiveActions,
  BranchLabel,
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  BODY_CLS,
  DevServerBody,
} from './stackParts';

/**
 * Review section lab, round 1 — the loop back to the agent. Three surfaces:
 * notes on the diff that land in the agent's prompt, the preview panel for
 * QA, and the pull request inbox with locally staged reviews.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const DESK_MAGENTA =
  'radial-gradient(120% 140% at 15% 0%, rgba(218, 119, 242, 0.24), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(251, 113, 133, 0.12), transparent 55%), linear-gradient(180deg, #211627, #141117)';

/** One tall wrapper drives all beats — same scrub as the Build theater. */
function useTheaterScrub(keys: readonly string[]) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState(0);
  const last = useRef(-1);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const next = clamp01(-rect.top / (rect.height - vh));
      const rounded = Math.round(next * 800);
      if (rounded !== last.current) {
        last.current = rounded;
        setT(next);
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const step = 0.78 / (keys.length - 1);
  const p = (k: string) => {
    const i = keys.indexOf(k);
    if (i < 0) return 0;
    return clamp01((t - i * step) / (step * 0.64));
  };
  return { wrapRef, p };
}

function Line({ p, at, children }: { p: number; at: number; children: ReactNode }) {
  const v = clamp01((p - at) / 0.08);
  if (v <= 0) return null;
  return <div style={{ opacity: v, transform: `translateY(${(1 - v) * 4}px)` }}>{children}</div>;
}

/* ─── The noted diff pane ─────────────────────────────────────────── */

const NOTE_TEXT = 'does this survive sign-out? add a test';

const hl = (text: string, kind: 'add' | 'del') => (
  <span
    className="rounded-[3px] px-[2px]"
    style={{
      backgroundColor:
        kind === 'add'
          ? 'color-mix(in srgb, var(--color-diff-added) 25%, transparent)'
          : 'color-mix(in srgb, var(--color-diff-removed) 22%, transparent)',
    }}
  >
    {text}
  </span>
);

interface NotedLine {
  type: 'context' | 'addition' | 'deletion';
  oldNo?: number;
  newNo?: number;
  content: ReactNode;
  noteTarget?: boolean;
}

const NOTED_LINES: NotedLine[] = [
  { type: 'context', oldNo: 2, newNo: 2, content: "import { Step } from './Step';" },
  {
    type: 'addition',
    newNo: 3,
    content: <>import {'{ useOnboardingProgress }'} from {hl("'./useOnboardingProgress'", 'add')};</>,
  },
  { type: 'context', oldNo: 3, newNo: 4, content: '' },
  { type: 'deletion', oldNo: 4, content: 'export function Stepper() {' },
  {
    type: 'addition',
    newNo: 5,
    content: <>export function Stepper({hl('{ accountId }: { accountId: string }', 'add')}) {'{'}</>,
  },
  {
    type: 'deletion',
    oldNo: 5,
    content: <>{'  const [step, setStep] = '}{hl('useState(0)', 'del')};</>,
  },
  {
    type: 'addition',
    newNo: 6,
    content: <>{'  const { step, setStep } = '}{hl('useOnboardingProgress(accountId)', 'add')};</>,
    noteTarget: true,
  },
  { type: 'context', oldNo: 6, newNo: 7, content: '  const total = 3;' },
  { type: 'context', oldNo: 7, newNo: 8, content: '' },
  { type: 'context', oldNo: 8, newNo: 9, content: '  return (' },
];

function NotedDiffLineRow({ line, noted }: { line: NotedLine; noted?: boolean }) {
  const lineBg =
    line.type === 'addition' ? 'bg-diff-added/10' : line.type === 'deletion' ? 'bg-diff-removed/[0.08]' : '';
  const gutterBg =
    line.type === 'addition'
      ? 'bg-diff-added/[0.12]'
      : line.type === 'deletion'
        ? 'bg-diff-removed/10'
        : 'bg-terminal-inset';
  const prefix = line.type === 'context' ? ' ' : line.type === 'addition' ? '+' : '-';
  const prefixColor =
    line.type === 'addition' ? 'text-diff-added' : line.type === 'deletion' ? 'text-diff-removed' : 'text-transparent';
  return (
    <div className={`flex font-mono text-[11px] leading-5 ${lineBg}`}>
      <span className={`flex shrink-0 select-none ${gutterBg} border-r border-ink/[0.07]`}>
        <span className="w-[36px] px-1.5 text-right text-ink/25">{line.oldNo ?? ''}</span>
        <span className="w-[36px] px-1.5 text-right text-ink/25">{line.newNo ?? ''}</span>
      </span>
      <span className="flex-1 pl-2 pr-2 whitespace-pre-wrap break-words text-diff-fg min-w-0">
        <span className={`inline-block w-3 select-none ${prefixColor}`}>{prefix}</span>
        {line.content}
        {noted && <span className="diff-demo-note-chip">✓ sent to claude</span>}
      </span>
    </div>
  );
}

const PANEL_BUTTON =
  'w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-ink/60 shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5';

/** The floating capsule from the app's diff panel: the staged notes plus
 * Copy and Send, where Send pastes into the terminal the panel is split
 * against. */
function NotesIsland({ count, flash }: { count: number; flash?: boolean }) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <div
        className="inline-flex items-center h-7 glass-bevel relative border border-bezel rounded-[12px] overflow-hidden"
        style={{ background: '#212126', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)' }}
      >
        <span className="h-full px-2.5 flex items-center gap-1.5 font-sans text-[13px] font-medium text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          {count} {count === 1 ? 'note' : 'notes'}
        </span>
        <span aria-hidden className="w-px h-3 bg-ink/10 self-center" />
        <span className="h-full px-2.5 flex items-center text-text-secondary [&>svg]:w-3.5 [&>svg]:h-3.5">
          <Icon name="copy" />
        </span>
        <span aria-hidden className="w-px h-3 bg-ink/10 self-center" />
        <span
          className={`h-full px-2.5 flex items-center [&>svg]:w-3.5 [&>svg]:h-3.5 transition-colors duration-200 ${
            flash ? 'bg-accent text-accent-ink' : 'text-text-secondary'
          }`}
        >
          <Icon name="terminal" />
        </span>
      </div>
    </div>
  );
}

/** The diff panel mid-review: word-level highlights, a note being written on
 * a changed line, and the island that hands the notes to the agent.
 * `pNote` types the note, `pSend` sends it, `pFix` is the agent's follow-up. */
function NotedDiffPane({ pNote, pSend, pFix }: { pNote: number; pSend: number; pFix: number }) {
  const typed = Math.round(clamp01((pNote - 0.25) / 0.6) * NOTE_TEXT.length);
  const composing = pNote > 0.18 && pSend <= 0.3;
  const sent = pSend > 0.3;
  const flash = pSend > 0.3 && pSend < 0.75;

  return (
    <div className="flex flex-col absolute inset-0 overflow-hidden bg-terminal-bg">
      <div className="pane-ledge over-well relative z-30 px-3 py-2 text-sm text-ink/70 flex items-center gap-2 shrink-0">
        <span className={PANEL_BUTTON}>
          <Icon name="sidebar-simple" />
        </span>
        <span className="flex items-center gap-1 font-mono text-[13px] text-ink/70">
          <Icon name="git-branch" className="w-3.5 h-3.5 text-ink/45" />
          main
          <Icon name="caret-down" className="!w-3 !h-3 text-ink/40" />
        </span>
        <span className="ml-auto min-w-0 truncate text-xs text-text-tertiary">3 files +130 -78</span>
        <span className={PANEL_BUTTON}>
          <Icon name="square-split-horizontal" />
        </span>
        <span className={PANEL_BUTTON}>
          <Icon name="x" />
        </span>
      </div>
      <div className="diff-well diff-list relative flex-1 overflow-hidden pb-3">
        <div className="diff-card mx-4 mt-3 rounded-[14px] border border-bezel bg-diff-card overflow-clip">
          <div className="pane-ledge sticky top-0 z-10 flex items-center gap-2 px-4 h-9 bg-terminal-surface">
            <span
              className="shrink-0 w-4 h-4 rounded border border-ink/25 text-transparent flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3"
              aria-hidden="true"
            >
              <Icon name="check" />
            </span>
            <span className="flex-1 min-w-0 truncate font-mono text-[13px]">
              <span className="text-ink/35">src/onboarding/</span>
              <span className="text-ink/90">Stepper.tsx</span>
            </span>
            <span className="shrink-0 text-[10px] px-1 py-px rounded font-medium bg-ink/[0.06] text-ink/40">
              modified
            </span>
            <span className="shrink-0 font-mono text-[11px]">
              <span className="text-diff-added">+92</span> <span className="text-diff-removed">-14</span>
            </span>
          </div>
          <div className="flex items-center gap-3 py-1 pr-4 font-mono text-xs" style={{ paddingLeft: '86px' }}>
            <span className="shrink-0 text-ink/25">@@ -1,8 +1,12 @@</span>
            <span className="truncate text-ink/45">Stepper container</span>
          </div>
          {NOTED_LINES.map((line, i) => (
            <div key={i}>
              <NotedDiffLineRow line={line} noted={line.noteTarget && sent} />
              {line.noteTarget && composing && (
                <div className="diff-demo-composer">
                  <div className="diff-demo-composer-text">
                    {NOTE_TEXT.slice(0, typed)}
                    <span className="terminal-cursor" />
                  </div>
                  <div className="diff-demo-composer-foot">
                    <span className="diff-demo-composer-hint">↵ to save</span>
                    <span className="diff-demo-composer-send">Save note</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {(sent || typed >= NOTE_TEXT.length) && <NotesIsland count={1} flash={flash} />}
      </div>
    </div>
  );
}

/* ─── The reviewing session ───────────────────────────────────────── */

/** ClaudeShell with a multi-line pending block: the sent notes sit in the
 * prompt exactly as Send pastes them — unsent until Enter. */
function ReviewShell({ children, busy, pending }: { children: ReactNode; busy?: boolean; pending?: ReactNode }) {
  return (
    <div className={BODY_CLS}>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      <div className="shrink-0 mt-3">
        <div className="border-t border-white/15" />
        <div className="py-1.5 flex gap-2">
          <span className="text-white/55">❯</span>
          {pending ? (
            <div className="flex-1 min-w-0 text-white/85">{pending}</div>
          ) : (
            <span className="flex-1 min-w-0 truncate text-white/25">Type a follow-up&hellip;</span>
          )}
        </div>
        <div className="border-t border-white/15" />
        <div className="mt-1 text-white/35 text-[10px]">
          Opus 4.7 {busy ? '· esc to interrupt' : '· ⏎ to send'} · ↓ to manage
        </div>
      </div>
    </div>
  );
}

function PendingNotes() {
  return (
    <div className="min-w-0">
      <div className="truncate">1 note on rework-onboarding vs main.</div>
      <div className="truncate text-white/55">src/onboarding/Stepper.tsx:6</div>
      <div className="truncate text-white/40">&gt; const {'{ step, setStep }'} = useOnboardingProgress(accountId);</div>
      <div className="truncate">does this survive sign-out? add a test</div>
    </div>
  );
}

function ReviewSession({ p }: { p: (k: string) => number }) {
  const pending = p('send') > 0.5 && p('fix') <= 0.2;
  const fixing = p('fix') > 0.2;
  return (
    <ReviewShell busy={fixing} pending={pending ? <PendingNotes /> : undefined}>
      <Line p={p('read')} at={0}>
        <AssistantSay>Done — stepper shell, saved progress, and WelcomeIntro retired.</AssistantSay>
      </Line>
      <Line p={p('read')} at={0.3}>
        <ToolCall name="Bash" args="ouijit task set-status 101 in_review" />
        <ToolResult>
          #101 <span className="text-white/65">in_progress → in_review</span>
        </ToolResult>
      </Line>
      <Line p={p('fix')} at={0.2}>
        <div className="mt-2">
          <ClaudeUser>1 note on rework-onboarding vs main.</ClaudeUser>
          <div className="pl-4 text-white/40 truncate">src/onboarding/Stepper.tsx:6 · does this survive sign-out? add a test</div>
        </div>
      </Line>
      <Line p={p('fix')} at={0.42}>
        <AssistantSay>Good catch — progress resets on sign-out. Covering it with a test.</AssistantSay>
      </Line>
      <Line p={p('fix')} at={0.62}>
        <ToolCall name="Edit" args="src/onboarding/onboarding.test.tsx" />
        <ToolResult>
          <span className="text-[#3fb950]">+18</span>
          <span className="ml-2 text-white/55">lines</span>
        </ToolResult>
      </Line>
      <Line p={p('fix')} at={0.82}>
        <ToolCall name="Bash" args="npm test -- onboarding" />
        <ToolResult>
          <span className="text-[#3fb950]">PASS</span>
          <span className="ml-2 text-white/65">15 tests</span>
        </ToolResult>
      </Line>
    </ReviewShell>
  );
}

/** The review card: the task's terminal, diff split open, at whatever point
 * of the round-trip `p` describes. */
function RoundTripCard({ p }: { p: (k: string) => number }) {
  const fixtures = getPanelFixtures('pty-101-dev');
  const fixing = p('fix') > 0.2;
  return (
    <div className="relative" style={{ height: 480 }}>
      <TerminalCardView isActive>
        <TerminalHeaderView
          summaryType={fixing ? 'thinking' : 'ready'}
          isActive
          nameContent={
            <TerminalHeaderName
              label="claude"
              lastOscTitle={fixing ? 'Adding sign-out test...' : 'done · in review'}
            />
          }
          branchContent={<BranchLabel branch="rework-onboarding" />}
          actions={<ActiveActions fixtures={fixtures} openPanel="diff" onToggle={() => {}} />}
        />
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <ReviewSession p={p} />
          </div>
          <div className="pane-seam relative w-px shrink-0" />
          <div className="relative shrink-0" style={{ width: '50%' }}>
            <NotedDiffPane pNote={p('note')} pSend={p('send')} pFix={p('fix')} />
          </div>
        </div>
      </TerminalCardView>
    </div>
  );
}

/* ─── 1a · Round-trip — pinned stage, the note loop as the story ───── */

const LOOP_BEATS = [
  {
    key: 'read',
    title: 'Review where the work happened',
    body: 'The task lands in review with its diff one tab over — every change on the branch, against any base.',
  },
  {
    key: 'note',
    title: 'Leave notes on the lines',
    body: 'Write what you want changed on the line that needs it. Notes anchor to the code and follow it as it moves.',
  },
  {
    key: 'send',
    title: 'Send them to the agent',
    body: 'Send pastes every note into the agent’s prompt, quoted code and all. Nothing goes until you press Enter.',
  },
  {
    key: 'fix',
    title: 'The loop closes in place',
    body: 'Same session, same worktree: the agent picks the notes up and the diff updates under you.',
  },
] as const;

const LOOP_KEYS = LOOP_BEATS.map((b) => b.key);

const capOpacity = (p: (k: string) => number, i: number) => {
  const cur = i === 0 ? 1 : p(LOOP_KEYS[i]);
  const next = i + 1 < LOOP_KEYS.length ? p(LOOP_KEYS[i + 1]) : 0;
  return clamp01(cur / 0.35) * (1 - clamp01(next / 0.35));
};

export function ReviewVariantRoundTrip() {
  const { wrapRef, p } = useTheaterScrub(LOOP_KEYS);
  return (
    <div ref={wrapRef} style={{ height: '400vh' }}>
      <div className="bl-theater-sticky">
        <div className="plan-desk" style={{ backgroundImage: DESK_MAGENTA, padding: 32, width: '100%' }}>
          <RoundTripCard p={p} />
        </div>
        <div className="bl-theater-captions">
          {LOOP_BEATS.map((b, i) => (
            <div key={b.key} className="bl-theater-cap" style={{ opacity: capOpacity(p, i) }}>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── 1b · Inbox — the pull request surface as the hero ────────────── */

function PrWindow({ height }: { height: number }) {
  return (
    <div
      className="glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ height, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <MockPullRequests />
    </div>
  );
}

export function ReviewVariantInbox() {
  return (
    <div>
      <div className="plan-desk" style={{ backgroundImage: DESK_MAGENTA, padding: 32 }}>
        <PrWindow height={640} />
      </div>
      <div className="rl-caption-row">
        <div>
          <h3>Grouped by what needs you</h3>
          <p>Needs your review, authored, everything else. Browsing a pull request never checks anything out.</p>
        </div>
        <div>
          <h3>Drafts stay local</h3>
          <p>Agents stage review comments with their origin attached. Nothing reaches GitHub until you send them as one review.</p>
        </div>
        <div>
          <h3>Merge from here</h3>
          <p>Checks, threads, and the merge menu, driven by gh. Any pull request checks out as a task.</p>
        </div>
      </div>
    </div>
  );
}

/* ─── 1c · Rows — three surfaces, alternating sides, no scrub ──────── */

function StaticDeskCard({ children }: { children: ReactNode }) {
  return (
    <div className="plan-desk" style={{ backgroundImage: DESK_MAGENTA, padding: 24 }}>
      <div className="relative" style={{ height: 440 }}>{children}</div>
    </div>
  );
}

function PreviewQaCard() {
  const fixtures = getPanelFixtures('pty-101-dev');
  return (
    <TerminalCardView isActive>
      <TerminalHeaderView
        summaryType="ready"
        isActive
        nameContent={<TerminalHeaderName label="dev" lastOscTitle="live dev server" />}
        branchContent={<BranchLabel branch="rework-onboarding" />}
        actions={<ActiveActions fixtures={fixtures} openPanel="preview" onToggle={() => {}} />}
      />
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <DevServerBody />
        </div>
        <div className="pane-seam relative w-px shrink-0" />
        <div className="relative shrink-0" style={{ width: '50%' }}>
          {fixtures.preview && <MockPreviewPanel fixture={fixtures.preview} onClose={() => {}} />}
        </div>
      </div>
    </TerminalCardView>
  );
}

const STATIC_LOOP = (k: string) => ({ read: 1, note: 1, send: 1, fix: 0.7 })[k] ?? 0;

export function ReviewVariantRows() {
  return (
    <div className="rl-rows">
      <div className="rl-row">
        <div className="rl-row-copy">
          <h3>Mark up the diff, not a doc</h3>
          <p>
            Notes on changed lines flow straight into the agent&rsquo;s prompt — quoted code and all. The fix lands in
            the same worktree you&rsquo;re looking at.
          </p>
        </div>
        <div className="rl-row-stage">
          <div className="plan-desk" style={{ backgroundImage: DESK_MAGENTA, padding: 24 }}>
            <RoundTripCard p={STATIC_LOOP} />
          </div>
        </div>
      </div>
      <div className="rl-row rl-row--flip">
        <div className="rl-row-copy">
          <h3>Click through what they built</h3>
          <p>The preview panel points at the task&rsquo;s dev server. QA the change live before it merges.</p>
        </div>
        <div className="rl-row-stage">
          <StaticDeskCard>
            <PreviewQaCard />
          </StaticDeskCard>
        </div>
      </div>
      <div className="rl-row rl-row--wide">
        <div className="rl-row-copy">
          <h3>Pull requests, same window</h3>
          <p>
            An inbox grouped by what needs you. Drafts — yours and your agents&rsquo; — stay local until you send them
            as one review.
          </p>
        </div>
        <div className="rl-row-stage">
          <div className="plan-desk" style={{ backgroundImage: DESK_MAGENTA, padding: 32 }}>
            <PrWindow height={560} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 1d · Stages — one desk, a segmented control swaps the surface ── */

const STAGES = [
  { key: 'notes', label: 'Notes on the diff', caption: 'Notes on changed lines land in the agent’s prompt. You press Enter.' },
  { key: 'preview', label: 'Live preview', caption: 'QA the change against the task’s own dev server.' },
  { key: 'prs', label: 'Pull requests', caption: 'Drafts stage locally — yours and your agents’ — and send as one review.' },
] as const;

export function ReviewVariantStages() {
  const [stage, setStage] = useState<(typeof STAGES)[number]['key']>('notes');
  return (
    <div>
      <div className="rl-stage-tabs">
        <div
          className="inline-flex items-center h-8 glass-bevel relative border border-bezel rounded-[12px] overflow-hidden"
          style={{ background: '#212126' }}
        >
          {STAGES.map((s, i) => (
            <span key={s.key} className="inline-flex h-full">
              {i > 0 && <span aria-hidden className="w-px h-3 bg-ink/10 self-center" />}
              <button
                className={`h-full px-3 border-none font-sans text-[13px] font-medium transition-colors duration-150 ${
                  stage === s.key
                    ? 'bg-accent text-accent-ink'
                    : 'bg-transparent text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => setStage(s.key)}
              >
                {s.label}
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="plan-desk" style={{ backgroundImage: DESK_MAGENTA, padding: 32 }}>
        <div className="relative" style={{ height: 520 }}>
          {STAGES.map((s) => (
            <div
              key={s.key}
              className="absolute inset-0 transition-opacity duration-300"
              style={{ opacity: stage === s.key ? 1 : 0, pointerEvents: stage === s.key ? 'auto' : 'none' }}
            >
              {s.key === 'notes' && (
                <div style={{ paddingTop: 20 }}>
                  <RoundTripCard p={STATIC_LOOP} />
                </div>
              )}
              {s.key === 'preview' && (
                <div className="relative" style={{ height: 480, marginTop: 20 }}>
                  <PreviewQaCard />
                </div>
              )}
              {s.key === 'prs' && <PrWindow height={520} />}
            </div>
          ))}
        </div>
      </div>
      <div className="rl-stage-caption">{STAGES.find((s) => s.key === stage)?.caption}</div>
    </div>
  );
}
