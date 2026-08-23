import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { MockPullRequests } from './MockPullRequests';
import { getPanelFixtures } from './MockPanels';
import {
  ActiveActions,
  BranchLabel,
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  BODY_CLS,
} from './stackParts';
import { DeskWash } from './DeskWash';
import { useTheaterLoop, BeatDots } from './theaterLoop';

/**
 * Review section lab — the loop back to the agent, then the pull request.
 * Notes on the diff land in the agent's prompt; drafts on the pull request
 * stage locally and send as one review.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));


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

/** The review terminal: session left, noted diff split right. `receded` is
 * the stack's back-card treatment for while another surface holds the front. */
function RoundTripTerminal({ p, receded = false }: { p: (k: string) => number; receded?: boolean }) {
  const fixtures = getPanelFixtures('pty-101-dev');
  const fixing = p('fix') > 0.2;
  return (
    <TerminalCardView isActive={!receded} backDepth={receded ? 1 : 0}>
      <TerminalHeaderView
        summaryType={fixing && !receded ? 'thinking' : 'ready'}
        isActive={!receded}
        isBackCard={receded}
        stackPosition={receded ? 1 : undefined}
        nameContent={
          <TerminalHeaderName
            label={receded ? 'Rework onboarding flow' : 'claude'}
            lastOscTitle={receded ? 'done · 15 passed' : fixing ? 'Adding sign-out test...' : 'done · in review'}
          />
        }
        branchContent={receded ? undefined : <BranchLabel branch="rework-onboarding" />}
        actions={receded ? undefined : <ActiveActions fixtures={fixtures} openPanel="diff" onToggle={() => {}} />}
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
  );
}

/** The review card: the task's terminal, diff split open, at whatever point
 * of the round-trip `p` describes. */
function RoundTripCard({ p }: { p: (k: string) => number }) {
  return (
    <div className="relative" style={{ height: 480 }}>
      <RoundTripTerminal p={p} />
    </div>
  );
}

/* ─── 1a · Round-trip — pinned stage, the note loop as the story ───── */

const LOOP_BEATS = [
  {
    key: 'read',
    title: 'Start from the diff',
    body: 'The task lands in review with its diff one tab over, showing every change on the branch against any base.',
  },
  {
    key: 'note',
    title: 'Comment inline',
    body: 'Write what you want changed on the line that needs it. Notes anchor to the code and follow it as it moves.',
  },
  {
    key: 'send',
    title: 'Send the notes',
    body: 'Send pastes every note into the agent’s prompt, with the code each one quotes. Nothing goes until you press Enter.',
  },
  {
    key: 'fix',
    title: 'Watch the fixes land',
    body: 'The agent picks up the notes in the same session and worktree. The diff updates as it works.',
  },
] as const;

const LOOP_KEYS = LOOP_BEATS.map((b) => b.key);

interface Beat {
  key: string;
  title: string;
  body: string;
}

const capOpacity = (beats: readonly Beat[], p: (k: string) => number, i: number) => {
  const cur = i === 0 ? 1 : p(beats[i].key);
  const next = i + 1 < beats.length ? p(beats[i + 1].key) : 0;
  return clamp01(cur / 0.35) * (1 - clamp01(next / 0.35));
};

function TheaterCaps({ beats, p }: { beats: readonly Beat[]; p: (k: string) => number }) {
  return (
    <div className="bl-theater-captions">
      {beats.map((b, i) => (
        <div key={b.key} className="bl-theater-cap" style={{ opacity: capOpacity(beats, p, i) }}>
          <h3>{b.title}</h3>
          <p>{b.body}</p>
        </div>
      ))}
    </div>
  );
}

export function ReviewVariantRoundTrip() {
  const { wrapRef, p } = useTheaterScrub(LOOP_KEYS);
  return (
    <div ref={wrapRef} style={{ height: '400vh' }}>
      <div className="bl-theater-sticky">
        <div className="plan-desk desk-wash desk-wash--prism" style={{ padding: 32, width: '100%' }}>
          <DeskWash />
          <RoundTripCard p={p} />
        </div>
        <TheaterCaps beats={LOOP_BEATS} p={p} />
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
      <div className="plan-desk desk-wash desk-wash--prism" style={{ padding: 32 }}>
          <DeskWash />
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

/* ─── The condensed pull request ──────────────────────────────────── */

function MiniAvatar({ login, size }: { login: string; size: number }) {
  let hash = 0;
  for (let i = 0; i < login.length; i++) hash = (hash * 31 + login.charCodeAt(i)) % 360;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full select-none"
      style={{ width: size, height: size, background: `color-mix(in srgb, hsl(${hash} 55% 55%) 30%, transparent)` }}
    >
      <span
        aria-hidden
        className="font-sans font-medium leading-none text-ink/70"
        style={{ fontSize: Math.max(9, Math.round(size * 0.45)) }}
      >
        {login[0].toUpperCase()}
      </span>
    </span>
  );
}

const SEG = 'h-full px-2.5 flex items-center gap-1.5 font-sans text-[13px] font-medium';
const SEG_DIVIDER = <span aria-hidden className="w-px h-3 bg-ink/10 self-center" />;

function PrFact({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-2 w-[110px] shrink-0 text-[14px] text-text-tertiary">
        <Icon name={icon} className="w-4 h-4 shrink-0 opacity-70" />
        {label}
      </span>
      <span className="flex items-center gap-1.5 min-w-0 text-[14px] text-text-primary">{children}</span>
    </div>
  );
}

function DraftRow({ path, line, origin, body }: { path: string; line: number; origin?: string; body: string }) {
  const cut = path.lastIndexOf('/');
  return (
    <div className="rounded-[10px] border border-bezel bg-ink/[0.03] px-3.5 py-2.5 flex flex-col gap-1">
      <div className="flex items-center gap-2 min-w-0">
        <span className="min-w-0 truncate font-mono text-[12px] text-text-tertiary">
          {path.slice(0, cut + 1)}
          <span className="text-text-secondary">{path.slice(cut + 1)}</span>:{line}
        </span>
        <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[12px] text-accent">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          {origin ? `${origin} · unsent` : 'unsent'}
        </span>
      </div>
      <div className="text-sm text-text-primary leading-relaxed">{body}</div>
    </div>
  );
}

/** The pull request surface reduced to its review essentials: the header
 * segment, the facts, and the staged drafts. Same task, one commit later. */
function CondensedPrCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="glass-bevel relative h-full flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <header className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-3 px-3">
        <span className="flex items-center gap-2 min-w-0 text-text-secondary">
          <Icon name="git-pull-request" className="w-4 h-4 shrink-0 text-vcs-added" />
          <span className="truncate text-[15px]">Rework onboarding flow</span>
        </span>
        {!compact && (
          <nav className="flex items-center gap-4 mx-auto shrink-0 self-stretch">
            <span className="flex items-center px-0.5 border-b-2 -mb-px border-accent text-[13px] font-medium text-text-primary">
              Summary
            </span>
            <span className="flex items-center px-0.5 border-b-2 -mb-px border-transparent text-[13px] font-medium text-text-tertiary">
              Timeline
            </span>
            <span className="flex items-center gap-1.5 px-0.5 border-b-2 -mb-px border-transparent text-[13px] font-medium text-text-tertiary">
              Code <span className="opacity-50 tabular-nums">3</span>
            </span>
          </nav>
        )}
        <div className={`flex items-center gap-1 shrink-0 ${compact ? 'ml-auto' : ''}`}>
          <div
            className="inline-flex items-center h-7 glass-bevel relative border border-bezel rounded-[12px] overflow-hidden"
            style={{ background: '#212126' }}
          >
            <span className={`${SEG} text-text-secondary`}>
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />2 unsent
            </span>
            {SEG_DIVIDER}
            <span className={`${SEG} text-text-secondary`}>Review</span>
            {SEG_DIVIDER}
            <span className={`${SEG} bg-accent text-accent-ink`}>Merge</span>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={`h-full ${compact ? '' : 'w-full max-w-3xl mx-auto'} px-6 py-5 flex flex-col gap-4`}>
          <header className="flex flex-col gap-2">
            <div className="text-[21px] leading-tight font-medium text-text-primary">Rework onboarding flow</div>
            <div className="flex items-center gap-2 text-[13px] text-text-secondary">
              <MiniAvatar login="prentice" size={18} />
              <span className="text-text-primary">prentice</span>
              <span className="text-text-tertiary opacity-60">·</span>
              <span>just now</span>
              <span className="text-text-tertiary opacity-60">·</span>
              <span className="flex items-center gap-1">
                #501
                <Icon name="arrow-square-out" className="w-3.5 h-3.5 opacity-60" />
              </span>
              <span className="text-text-tertiary opacity-60">·</span>
              <span>Ready for review</span>
            </div>
          </header>
          <dl className="flex flex-col gap-2">
            <PrFact icon="git-branch" label="Branch">
              <span className="font-mono text-[13px]">rework-onboarding</span>
              <Icon name="caret-right" className="w-3 h-3 text-text-tertiary" />
              <span className="font-mono text-[13px]">main</span>
              <span className="font-mono text-[13px] tabular-nums ml-1">
                <span className="text-diff-added">+130</span> <span className="text-diff-removed">-78</span>
              </span>
            </PrFact>
            <PrFact icon="user-circle" label="Task">
              <span className="font-mono text-[13px]">T-101</span>
              <span className="text-text-tertiary">In review</span>
              <Icon name="arrow-right" className="w-3.5 h-3.5 opacity-60" />
            </PrFact>
            <PrFact icon="clock" label="Checks">6 passing</PrFact>
          </dl>
          <section className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center gap-2 pb-2 border-b border-ink/[0.08]">
              <span className="text-[17px] font-medium text-text-primary">Review</span>
              <span className="text-[14px] text-text-tertiary">2 drafts</span>
            </div>
            <DraftRow
              path="src/onboarding/Stepper.tsx"
              line={6}
              origin="claude"
              body="prefetch preferences before the first step renders — the stepper flashes step 0 on slow accounts"
            />
            <DraftRow path="src/onboarding/useOnboardingProgress.ts" line={9} body="fall back to 0 when preferences are missing" />
          </section>
        </div>
      </div>
    </div>
  );
}

/* ─── 2a · Two acts — the loop, then the pull request takes the front ─ */

const TWO_ACT_BEATS = [
  ...LOOP_BEATS,
  {
    key: 'pr',
    title: 'Land the pull request',
    body: 'Every open pull request is here — yours and your teammates’. Drafts stay local until you send them as one review, and you merge without opening GitHub.',
  },
] as const;

const TWO_ACT_KEYS = TWO_ACT_BEATS.map((b) => b.key);

export function ReviewVariantTwoAct() {
  const { rootRef, p, progress } = useTheaterLoop(TWO_ACT_KEYS);
  // Binary like the stack promotions, with the same animated depth change —
  // a crossfade tied to the loop would leave both surfaces half-faded.
  const prOn = p('pr') > 0.35;
  const activeIdx = TWO_ACT_KEYS.reduce((acc, k, i) => (p(k) > 0.35 ? i : acc), 0);
  return (
    <div ref={rootRef} className="bl-theater">
      <div className="plan-desk desk-wash desk-wash--prism" style={{ padding: 32, paddingTop: 48, width: '100%' }}>
          <DeskWash />
          <div className="relative" style={{ height: 480 }}>
            <RoundTripTerminal p={p} receded={prOn} />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 20,
                opacity: prOn ? 1 : 0,
                transform: `translateY(${prOn ? 0 : 48}px)`,
                transition: 'opacity 0.25s ease, transform 0.25s ease',
                pointerEvents: 'none',
              }}
            >
              <CondensedPrCard />
            </div>
          </div>
        </div>
      <div className="beat-row">
        {TWO_ACT_BEATS.map((b, i) => (
          <div key={b.key} className={i === activeIdx ? 'is-active' : undefined}>
            <h3>{b.title}</h3>
            <p>{b.body}</p>
          </div>
        ))}
      </div>
      <BeatDots progress={progress} />
    </div>
  );
}

/* ─── The section, as shipped on the c page ───────────────────────── */

export function ReviewSection() {
  return (
    <div>
      <h2 className="plan-v-headline">Review together</h2>
      <ReviewVariantTwoAct />
    </div>
  );
}

/* ─── 2b · Loop + ledger — the theater, then a static pull request band ─ */

export function ReviewVariantLoopLedger() {
  return (
    <div>
      <ReviewVariantRoundTrip />
      <div className="rl-ledger">
        <div className="rl-ledger-card">
          <div className="plan-desk desk-wash desk-wash--prism h-full" style={{ padding: 24 }}>
          <DeskWash />
            <div style={{ height: 440 }}>
              <CondensedPrCard />
            </div>
          </div>
        </div>
        <div className="rl-ledger-copy">
          <div>
            <h3>Then, the pull request</h3>
            <p>
              The review hook opens it when the task hits review. Drafts — yours and your agents&rsquo; — stay
              local until you send them as one review.
            </p>
          </div>
          <div>
            <h3>Merge from here</h3>
            <p>Checks, threads, and the merge menu, driven by gh.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 2c · Split hero — one screen, no scrub: noted diff + pull request ─ */

export function ReviewVariantSplitHero() {
  return (
    <div>
      <div className="plan-desk desk-wash desk-wash--prism" style={{ padding: 28 }}>
          <DeskWash />
        <div className="flex gap-6" style={{ height: 480 }}>
          <div
            className="glass-bevel relative flex-1 min-w-0 rounded-[14px] overflow-hidden border border-bezel-panel"
            style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
          >
            <NotedDiffPane pNote={1} pSend={1} pFix={1} />
          </div>
          <div className="flex-1 min-w-0">
            <CondensedPrCard compact />
          </div>
        </div>
      </div>
      <div className="rl-caption-row">
        <div>
          <h3>Notes go back to the agent</h3>
          <p>Write on the changed line; Send pastes every note into the agent&rsquo;s prompt, quoted code and all.</p>
        </div>
        <div>
          <h3>Drafts stay local</h3>
          <p>Pull request comments — yours and your agents&rsquo; — stage locally and send as one review.</p>
        </div>
        <div>
          <h3>Merge from here</h3>
          <p>Checks, threads, and the merge menu, driven by gh.</p>
        </div>
      </div>
    </div>
  );
}
