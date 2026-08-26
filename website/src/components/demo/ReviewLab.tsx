import type { ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { MockAnalysis, HotspotTip } from './MockAnalysis';
import { getPanelFixtures } from './MockPanels';
import {
  ActiveActions,
  BranchLabel,
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  TuiStatus,
  EditDiff,
  WorkingLine,
  BODY_CLS,
} from './stackParts';
import { DeskWash } from './DeskWash';
import { useTheaterLoop, BeatDots } from './theaterLoop';

/**
 * The review section: what the history says about the diff, the loop back to
 * the agent, then the pull request. Notes on the diff land in the agent's
 * prompt; drafts on the pull request stage locally and send as one review.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function Line({ p, at, children }: { p: number; at: number; children: ReactNode }) {
  const v = clamp01((p - at) / 0.08);
  if (v <= 0) return null;
  return <div style={{ opacity: v, transform: `translateY(${(1 - v) * 4}px)` }}>{children}</div>;
}

/* ─── The noted diff pane ─────────────────────────────────────────── */

/* Static copies of the app's InlineCommentCard and InlineCommentBox —
   the same classes, with the typing animation in place of the textarea. */

function MockCommentCard({ label, body }: { label: string; body: ReactNode }) {
  return (
    <div className="relative glass-bevel block w-[calc(100%-176px)] mx-[88px] my-1.5 text-left px-3 py-2 bg-terminal-surface border border-bezel rounded-[12px] text-sm text-text-secondary">
      <span className="block text-[11px] text-accent mb-0.5">{label}</span>
      {body}
    </div>
  );
}

function MockCommentBox({
  text,
  placeholder,
  saveLabel,
  hint,
}: {
  text: string;
  placeholder: string;
  saveLabel: string;
  hint: string;
}) {
  return (
    <div className="relative glass-bevel mx-[88px] my-1.5 px-3 py-2.5 bg-terminal-surface border border-bezel rounded-[12px]">
      <div className="field resize-y border-accent ring-3 ring-accent-light" style={{ minHeight: 76 }}>
        {text ? (
          <>
            {text}
            <span className="terminal-cursor" />
          </>
        ) : (
          <span className="text-text-tertiary">{placeholder}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className={`btn-primary btn-compact ${text ? '' : 'opacity-50'}`}>{saveLabel}</span>
        <span className="btn-secondary btn-compact">Cancel</span>
      </div>
      <p className="text-[11px] text-text-tertiary mt-1.5">{hint}</p>
    </div>
  );
}

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
  {
    type: 'addition',
    newNo: 3,
    content: <>import {'{ useOnboardingProgress }'} from {hl("'./useOnboardingProgress'", 'add')};</>,
  },
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

const HOOK_LINES = [
  "import { useEffect, useState } from 'react';",
  "import { readPreference, writePreference } from '../account/preferences';",
  '',
  'export function useOnboardingProgress(accountId: string) {',
  '  const key = `onboarding:${accountId}`;',
  '  const stored = readPreference(key);',
  '  const [step, setStep] = useState(stored.step);',
  '',
  '  useEffect(() => writePreference(key, { step }), [key, step]);',
  '  return { step, setStep };',
];

function HotspotChip() {
  return (
    <span className="shrink-0 flex items-center gap-1 text-[10px] px-1 py-px rounded font-medium bg-git-light text-git">
      <Icon name="flame" className="!w-3 !h-3" />
      hotspot
    </span>
  );
}

/**
 * The tooltip the chip carries in the app, opened where a hover would open
 * it. It sits in the well rather than the card, which clips its own overflow
 * to round the diff rows — so it repeats the card's box (inset-x-4 top-3) and
 * clears the file header (pt-9) to land under the row the chip is on.
 */
function HotspotTipOverlay() {
  return (
    <div className="absolute inset-x-4 top-3 z-40 pt-9 pr-4 flex justify-end pointer-events-none">
      <span className="mt-1.5 animate-tooltip-pop">
        <HotspotTip path="src/onboarding/Stepper.tsx" />
      </span>
    </div>
  );
}

function NotedDiffLineRow({ line }: { line: NotedLine }) {
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
function NotedDiffPane({
  pNote,
  pSend,
  pFix,
  tip,
}: {
  pNote: number;
  pSend: number;
  pFix: number;
  tip?: boolean;
}) {
  /* Typing takes as much of the beat as it can get: it starts as soon as the
     box opens and finishes just before the note is saved. The beat is short,
     and idling at either end of it is what makes the note look pasted. */
  const typed = Math.round(clamp01((pNote - 0.15) / 0.72) * NOTE_TEXT.length);
  const saved = pNote > 0.92 || pSend > 0.05;
  const composing = pNote > 0.18 && !saved;
  const flash = pSend > 0.12 && pSend < 0.55;

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
        {tip && <HotspotTipOverlay />}
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
            <HotspotChip />
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
              <NotedDiffLineRow line={line} />
              {line.noteTarget && composing && (
                <MockCommentBox
                  text={NOTE_TEXT.slice(0, typed)}
                  placeholder="Note for the agent…"
                  saveLabel="Add note"
                  hint="Kept with this worktree until you hand it to the agent."
                />
              )}
              {line.noteTarget && saved && <MockCommentCard label="Note · 6" body={NOTE_TEXT} />}
            </div>
          ))}
        </div>
        {/* The second of the diff's three files. Split against the session it
            falls below the fold; on its own card it is the rest of the well. */}
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
              <span className="text-ink/90">useOnboardingProgress.ts</span>
            </span>
            <span className="shrink-0 text-[10px] px-1 py-px rounded font-medium bg-vcs-added/15 text-vcs-added">
              added
            </span>
            <span className="shrink-0 font-mono text-[11px] text-diff-added">+38</span>
          </div>
          {HOOK_LINES.map((content, i) => (
            <NotedDiffLineRow key={i} line={{ type: 'addition', newNo: i + 1, content }} />
          ))}
        </div>
        {saved && <NotesIsland count={1} flash={flash} />}
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
        <TuiStatus busy={busy} />
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

const FIXED_AT = 0.92;

function ReviewSession({ p }: { p: (k: string) => number }) {
  const pending = p('send') > 0.2 && p('fix') <= 0.06;
  const fixing = p('fix') > 0.06;
  const fixed = p('fix') > FIXED_AT;
  return (
    <ReviewShell busy={fixing && !fixed} pending={pending ? <PendingNotes /> : undefined}>
      <Line p={p('scan')} at={0}>
        <AssistantSay>Done — stepper shell, saved progress, and WelcomeIntro retired.</AssistantSay>
      </Line>
      <Line p={p('scan')} at={0.08}>
        <ToolCall name="Bash" args="ouijit task set-status 101 in_review" />
        <ToolResult>
          #101 <span className="text-white/65">in_progress → in_review</span>
        </ToolResult>
      </Line>
      <Line p={p('fix')} at={0.08}>
        <div className="mt-2">
          <ClaudeUser>1 note on rework-onboarding vs main.</ClaudeUser>
          <div className="pl-4 text-white/40 truncate">src/onboarding/Stepper.tsx:6 · does this survive sign-out? add a test</div>
        </div>
      </Line>
      <Line p={p('fix')} at={0.32}>
        <AssistantSay>Good catch — progress resets on sign-out. Covering it with a test.</AssistantSay>
      </Line>
      <Line p={p('fix')} at={0.48}>
        <ToolCall name="Read" args="src/onboarding/useOnboardingProgress.ts" />
        <ToolResult>Read 38 lines</ToolResult>
      </Line>
      <Line p={p('fix')} at={0.62}>
        <ToolCall name="Edit" args="src/onboarding/onboarding.test.tsx" />
        <ToolResult>
          <span className="text-[#3fb950]">+18</span>
          <span className="ml-2 text-white/55">lines</span>
        </ToolResult>
        <EditDiff
          rows={[
            [42, '+', "it('keeps progress across sign-out', async () => {"],
            [43, '+', '  await signIn(user); await advanceTo(2);'],
            [44, '+', '  await signOut(); await signIn(user);'],
            [45, '+', '  expect(await currentStep()).toBe(2);'],
          ]}
        />
      </Line>
      <Line p={p('fix')} at={0.8}>
        <ToolCall name="Bash" args="npm test -- onboarding" />
      </Line>
      {fixing && !fixed && <WorkingLine verb="Verifying" elapsed="1m 12s" tokens="4.3k" />}
      <Line p={p('fix')} at={0.92}>
        <ToolResult>
          <span className="text-[#3fb950]">PASS</span>
          <span className="ml-2 text-white/65">15 tests</span>
          <span className="ml-2 text-white/35">in 1.4s</span>
        </ToolResult>
      </Line>
    </ReviewShell>
  );
}

/** The review terminal: session left, noted diff split right. `depth` is its
 * place in the stack — 0 while it holds the front, higher once it does not. */
function RoundTripTerminal({ p, depth }: { p: (k: string) => number; depth: number }) {
  const fixtures = getPanelFixtures('pty-101-dev');
  const receded = depth > 0;
  const fixing = p('fix') > 0.06;
  /* The beat ends with the fix landed, so the card stops reading as busy
     before the pull request takes the stage. FIXED_AT is shared with the
     session body, which drops its working line on the same frame. */
  const fixed = p('fix') > FIXED_AT;
  return (
    <>
      <TerminalHeaderView
        summaryType={fixing && !fixed && !receded ? 'thinking' : 'ready'}
        isActive={!receded}
        isBackCard={receded}
        stackPosition={receded ? depth : undefined}
        nameContent={
          <TerminalHeaderName
            label="Rework onboarding flow"
            lastOscTitle={fixed ? 'done · 15 passed' : fixing ? 'Adding sign-out test...' : 'done · in review'}
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
    </>
  );
}

const LOOP_KEYS = ['note', 'send', 'fix'] as const;

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

const RISK_ROWS = [
  {
    icon: 'flame',
    path: 'src/onboarding/Stepper.tsx',
    text: '34 commits in 12 months · most edits by prentice',
  },
  {
    icon: 'git-fork',
    path: 'src/onboarding/Stepper.tsx',
    text: 'Usually changes with src/account/preferences.ts — not in this pull request',
  },
];

/** The pull request surface reduced to its review essentials: the header
 * segment, the facts, and the staged drafts. Same task, one commit later. */
function CondensedPrCard() {
  return (
    <>
      <header className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-3 px-3">
        <span className="flex items-center gap-2 min-w-0 text-text-secondary">
          <Icon name="git-pull-request" className="w-4 h-4 shrink-0 text-vcs-added" />
          <span className="truncate text-[15px]">Rework onboarding flow</span>
        </span>
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
        <div className="flex items-center gap-1 shrink-0">
          <div
            className="inline-flex items-center h-7 glass-bevel relative border border-bezel rounded-[12px] overflow-hidden"
            style={{ background: '#212126' }}
          >
            <span className={`${SEG} text-text-secondary`}>
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />1 unsent
            </span>
            {SEG_DIVIDER}
            <span className={`${SEG} text-text-secondary`}>Review</span>
            {SEG_DIVIDER}
            <span className={`${SEG} bg-accent text-accent-ink`}>Merge</span>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full max-w-3xl mx-auto px-6 py-5 flex flex-col gap-4">
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
          <section className="flex flex-col gap-2 min-h-0">
            <div className="flex items-center gap-2 pb-2 border-b border-ink/[0.08]">
              <span className="text-[17px] font-medium text-text-primary">Risk</span>
              <span className="text-[14px] text-text-tertiary">{RISK_ROWS.length}</span>
            </div>
            {RISK_ROWS.map((row) => (
              <div key={row.text} className="flex items-center gap-2.5 py-1">
                <Icon name={row.icon} className="w-3.5 h-3.5 shrink-0 text-git/80" />
                <span className="shrink-0 font-mono text-[12px] text-text-secondary">{row.path}</span>
                <span className="min-w-0 truncate font-mono text-[10px] text-text-tertiary">{row.text}</span>
              </div>
            ))}
          </section>
          <section className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center gap-2 pb-2 border-b border-ink/[0.08]">
              <span className="text-[17px] font-medium text-text-primary">Review</span>
              <span className="text-[14px] text-text-tertiary">1 draft</span>
            </div>
            <DraftRow
              path="src/onboarding/Stepper.tsx"
              line={6}
              origin="claude"
              body="prefetch preferences before the first step renders — the stepper flashes step 0 on slow accounts"
            />
          </section>
        </div>
      </div>
    </>
  );
}

/* ─── The section: what the history says, the loop, the pull request ─ */

const ANALYSIS_KEYS = ['scan', 'chip'] as const;
const BEAT_KEYS = [...ANALYSIS_KEYS, ...LOOP_KEYS, 'pr'] as const;

/**
 * The captions under the stage. Analysis and the round trip are one caption
 * each and several beats long: the panel and the chip are one reading shown
 * twice, and note, send and fix are phases of a single story. A caption
 * swapping mid-play reads as unrelated features.
 */
const CAPTIONS: { keys: readonly string[]; title: string; body: string }[] = [
  {
    keys: ANALYSIS_KEYS,
    title: 'Read the history before the diff',
    body: 'Analysis ranks every file by how often it changes and how tangled it is, from the git log alone. The same reading rides along in the diff: what a file moves with, and who holds it.',
  },
  {
    keys: LOOP_KEYS,
    title: 'Send notes back to the agent',
    body: 'Write what you want changed on the line that needs it. Send pastes every note into the agent’s prompt, quoted code and all, and the fix lands in the same session and worktree.',
  },
  {
    keys: ['pr'],
    title: 'Land the pull request',
    body: 'Review every open pull request without opening GitHub — checks, threads, and the merge menu. Drafts, yours beside your agents’, stay local until you send them as one review.',
  },
];

/** How many beats each caption spans, in caption order. */
const CAPTION_SPANS = CAPTIONS.map((c) => c.keys.length);

/** Every caption gets this long, whatever it spans. */
const CAPTION_MS = 5000;

/* A beat inside an n-beat caption runs n times as fast, so the caption still
   takes CAPTION_MS. The trailing entry is the hold before the loop restarts,
   which would otherwise sit a full caption's length at the end. */
const BEAT_SPEEDS = [...CAPTION_SPANS.flatMap((n) => Array<number>(n).fill(n)), 2];

/** Where the dot bar sits: a caption owns an equal share of it, so the bar
 *  and the lit caption agree however many beats that caption spans. */
function captionProgress(t: number): number {
  let start = 0;
  for (let i = 0; i < CAPTION_SPANS.length; i++) {
    const span = CAPTION_SPANS[i];
    if (t < start + span) return (i + (t - start) / span) / CAPTION_SPANS.length;
    start += span;
  }
  return 1;
}

/**
 * A surface's place in the stack: 0 is the front, higher is further back, and
 * a card the run has not reached yet waits below the front, where the promoted
 * one rises from. TerminalCardView draws the depth; this only has to say which
 * one, and get the paint order to agree with it.
 */
function StackCard({ depth, back, children }: { depth: number | null; back?: ReactNode; children: ReactNode }) {
  const waiting = depth === null;
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 10 - (depth ?? 0),
        opacity: waiting ? 0 : 1,
        transform: `translateY(${waiting ? 48 : 0}px)`,
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}
    >
      <TerminalCardView isActive={depth === 0} backDepth={depth ?? 0}>
        {/* Positioned inline: `.glass-bevel > *` pins every direct child to
            position relative, so the utility classes would leave the strip in
            flow, taking its height off the card's own content. */}
        {back && (
          <div
            className="bg-terminal-bg transition-opacity duration-200"
            style={{
              position: 'absolute',
              insetInline: 0,
              top: 0,
              zIndex: 40,
              opacity: !waiting && depth > 0 ? 1 : 0,
            }}
          >
            {back}
          </div>
        )}
        {children}
      </TerminalCardView>
    </div>
  );
}

/**
 * A panel's back-card row. A card behind another shows 24px of itself, and a
 * panel's own header centres its content in twice that — so the strip repeats
 * the identity at the back-card's metrics, over the header it hides.
 */
function BackStrip({ icon, label, detail }: { icon: string; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 pl-3 pr-3 pt-0.5 pb-1 min-h-9">
      <Icon name={icon} className="w-4 h-4 shrink-0 text-ink/45" />
      <span className="shrink-0 text-[13px] text-text-secondary">{label}</span>
      <span className="min-w-0 truncate font-mono text-[11px] text-text-tertiary">{detail}</span>
    </div>
  );
}

/** The four surfaces, in the order the run promotes them. */
const STACK = ['scan', 'chip', 'note', 'pr'] as const;

export function ReviewSection() {
  const { rootRef, p, t, active, seek } = useTheaterLoop(BEAT_KEYS, CAPTION_MS, BEAT_SPEEDS);
  /* Which surface holds the front, taken as a step rather than a ramp: the
     depth change is the app's own animation, and a crossfade tied to the loop
     would leave two cards half-faded on top of each other. */
  const front = STACK.reduce((n, key, i) => (i > 0 && p(key) > 0.05 ? i : n), 0);
  const depth = (i: number) => (i <= front ? front - i : null);

  return (
    <div ref={rootRef} className="bl-theater">
      <h2 className="plan-v-headline">Review in depth</h2>
      {/* The desk clears the deepest card: four cards is 72px of lift, plus
          enough for the header it peels back to show. */}
      <div className="plan-desk desk-wash desk-wash--prism" style={{ padding: 32, paddingTop: 96, width: '100%' }}>
        <DeskWash />
        <div className="relative" style={{ height: 520 }}>
          <StackCard
            depth={depth(0)}
            back={<BackStrip icon="binoculars" label="Analysis" detail="850 commits · 318 files" />}
          >
            <MockAnalysis showAdvice />
          </StackCard>
          <StackCard
            depth={depth(1)}
            back={<BackStrip icon="git-branch" label="main" detail="3 files +130 -78" />}
          >
            <div className="relative flex-1 min-h-0">
              <NotedDiffPane pNote={0} pSend={0} pFix={0} tip={front === 1} />
            </div>
          </StackCard>
          <StackCard depth={depth(2)}>
            <RoundTripTerminal p={p} depth={depth(2) ?? 0} />
          </StackCard>
          <StackCard depth={depth(3)}>
            <CondensedPrCard />
          </StackCard>
        </div>
      </div>
      <div className="beat-row">
        {CAPTIONS.map((c) => (
          <button
            type="button"
            key={c.title}
            className={c.keys.includes(BEAT_KEYS[active]) ? 'is-active' : undefined}
            onClick={() => seek(BEAT_KEYS.indexOf(c.keys[0] as (typeof BEAT_KEYS)[number]))}
          >
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </button>
        ))}
      </div>
      <BeatDots progress={captionProgress(t)} />
    </div>
  );
}
