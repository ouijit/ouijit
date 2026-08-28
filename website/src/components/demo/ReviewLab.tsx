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
 * the agent, then the same diff read through a lens. Notes on the diff land in
 * the agent's prompt; a lens regroups the change into the parts it is made of.
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
 * `pNote` types the note, `pSend` hands it to the agent. */
function NotedDiffPane({
  pNote,
  pSend,
  tip,
}: {
  pNote: number;
  pSend: number;
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
function RoundTripTerminal({ p, depth, tip }: { p: (k: string) => number; depth: number; tip?: boolean }) {
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
          <NotedDiffPane pNote={p('note')} pSend={p('send')} tip={tip} />
        </div>
      </div>
    </>
  );
}

const LOOP_KEYS = ['note', 'send', 'fix'] as const;

/* ─── The diff read through a lens ────────────────────────────────── */

const LENS_NAME = 'Decision first';

/** Dragged wider than the 220px the rail opens at, which truncates the
 *  longest of these names. */
const RAIL_WIDTH = 264;

interface LensFile {
  name: string;
  status: 'A' | 'D' | 'M';
  add?: number;
  del?: number;
  /** The hunk of it the document shows. */
  hunk: { range: string; context: string; lines: NotedLine[] };
}

const STATUS: Record<LensFile['status'], { icon: string; color: string; badge: string; label: string }> = {
  A: { icon: 'file-plus', color: 'text-vcs-added', badge: 'bg-vcs-added/15 text-vcs-added', label: 'added' },
  D: { icon: 'file-minus', color: 'text-vcs-deleted', badge: 'bg-vcs-deleted/15 text-vcs-deleted', label: 'deleted' },
  M: { icon: 'file-dashed', color: 'text-ink/50', badge: 'bg-ink/[0.06] text-ink/40', label: 'modified' },
};

const LENS_DIR = 'src/onboarding';

const LEGACY_LINES = [
  "import { useState } from 'react';",
  '',
  'const progress = new Map<string, number>();',
  '',
  'export function readProgress(accountId: string) {',
  '  return progress.get(accountId) ?? 0;',
  '}',
];

/** In tree order, which the document follows. */
const FLAT_FILES: LensFile[] = [
  {
    name: 'legacyProgress.ts',
    status: 'D',
    del: 64,
    hunk: {
      range: '@@ -1,64 +0,0 @@',
      context: 'legacyProgress',
      lines: LEGACY_LINES.map((content, i) => ({ type: 'deletion', oldNo: i + 1, content })),
    },
  },
  {
    name: 'Stepper.tsx',
    status: 'M',
    add: 92,
    del: 14,
    hunk: { range: '@@ -1,8 +1,12 @@', context: 'Stepper container', lines: NOTED_LINES },
  },
  {
    name: 'useOnboardingProgress.ts',
    status: 'A',
    add: 38,
    hunk: {
      range: '@@ -0,0 +1,38 @@',
      context: 'useOnboardingProgress',
      lines: HOOK_LINES.slice(0, 4).map((content, i) => ({ type: 'addition', newNo: i + 1, content })),
    },
  },
];

/** What the lens made of those same files. Stepper.tsx is in two parts: a
 *  part claims line ranges rather than whole files. */
const LENS_PARTS: { title: string; summary: string; files: LensFile[] }[] = [
  {
    title: 'The decision',
    summary: 'Step progress moves out of component state and into the account, where a reload can find it.',
    files: [FLAT_FILES[1], FLAT_FILES[2]],
  },
  {
    title: 'What it replaces',
    summary: 'The in-memory store the stepper kept, and the last call into it.',
    files: [FLAT_FILES[0]],
  },
  {
    title: 'Mechanical churn',
    summary: 'Imports and prop names the move dragged along.',
    files: [FLAT_FILES[1]],
  },
];

/** The app's `partEnter`: 55ms a part, so a grouping lays itself in. */
const partEnter = (i: number) => ({ className: 'lens-part-enter', style: { animationDelay: `${i * 55}ms` } });

function FileCounts({ file, size }: { file: LensFile; size: string }) {
  return (
    <span className={`shrink-0 font-mono ${size}`}>
      {file.add ? <span className="text-diff-added">+{file.add}</span> : null}
      {file.add && file.del ? ' ' : null}
      {file.del ? <span className="text-diff-removed">-{file.del}</span> : null}
    </span>
  );
}

function RailFile({ file }: { file: LensFile }) {
  return (
    <div className="flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] text-ink/70">
      <Icon name={STATUS[file.status].icon} className={`w-4 h-4 shrink-0 ${STATUS[file.status].color}`} />
      <span className="flex-1 min-w-0 truncate">{file.name}</span>
      <FileCounts file={file} size="text-[13px]" />
    </div>
  );
}

/** A part keeps the directory tree inside it, so which directories it touches
 *  still reads. */
function RailFiles({ files }: { files: LensFile[] }) {
  return (
    <>
      <div className="flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] text-ink/50">
        <Icon name="caret-down" className="!w-3 !h-3 shrink-0" />
        <span className="flex-1 min-w-0 truncate">{LENS_DIR}</span>
      </div>
      <div className="pl-3">
        {files.map((file) => (
          <RailFile key={file.name} file={file} />
        ))}
      </div>
    </>
  );
}

function LensRow({ label, hint, selected, aimed }: { label: string; hint?: string; selected?: boolean; aimed?: boolean }) {
  return (
    <span
      className={`w-full px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 transition-colors duration-100 ${
        aimed ? 'bg-ink/[0.08] text-text-primary' : 'text-text-secondary'
      }`}
    >
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[11px] text-text-tertiary shrink-0">{hint}</span>}
      {selected && <Icon name="check" className="w-3.5 h-3.5 text-accent shrink-0" />}
    </span>
  );
}

/** The picker over the rail's ledge. Picking a lens that has not been written
 *  for this diff spends an agent run writing it. */
function LensMenu({ aimed }: { aimed: boolean }) {
  return (
    <div
      className="absolute left-2 top-[46px] z-50 w-[17rem] flex flex-col overflow-hidden glass-bevel border border-bezel rounded-[12px] animate-tooltip-pop"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-menu)' }}
    >
      <div className="p-1 flex flex-col">
        <LensRow label="All files" hint="3" selected />
        <div className="my-1 mx-1 border-t border-ink/[0.06]" />
        <LensRow label={LENS_NAME} aimed={aimed} />
        <LensRow label="Risk first" />
        <div className="my-1 mx-1 border-t border-ink/[0.06]" />
        <LensRow label="Manage lenses…" />
      </div>
    </div>
  );
}

function LensTrigger({ writing, on }: { writing: boolean; on: boolean }) {
  return (
    <div
      className={`w-full h-full flex items-center gap-1.5 px-3 text-[13px] ${
        writing ? 'text-ink/45' : 'text-ink/70'
      }`}
    >
      <Icon name={on ? 'aperture' : 'tree-structure'} className="shrink-0 w-4 h-4 opacity-70" />
      <span className="flex-1 min-w-0 truncate">
        {writing ? `Writing ${LENS_NAME}…` : on ? LENS_NAME : 'All files'}
      </span>
      {!writing && <span className="shrink-0 font-mono text-[11px] text-ink/35">3</span>}
      {writing ? (
        <Icon
          name="arrows-clockwise"
          className="shrink-0 w-3 h-3 text-accent"
          style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
        />
      ) : (
        <Icon name="caret-down" className="shrink-0 w-3 h-3 text-ink/40" />
      )}
    </div>
  );
}

function DocFileCard({ file }: { file: LensFile }) {
  return (
    <div className="diff-card mx-4 mt-3 rounded-[14px] border border-bezel bg-diff-card overflow-clip">
      <div className="pane-ledge sticky top-0 z-10 flex items-center gap-2 px-4 h-9 bg-terminal-surface">
        <span
          className="shrink-0 w-4 h-4 rounded border border-ink/25 text-transparent flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3"
          aria-hidden="true"
        >
          <Icon name="check" />
        </span>
        <span className="flex-1 min-w-0 truncate font-mono text-[13px]">
          <span className="text-ink/35">{LENS_DIR}/</span>
          <span className="text-ink/90">{file.name}</span>
        </span>
        <span className={`shrink-0 text-[10px] px-1 py-px rounded font-medium ${STATUS[file.status].badge}`}>
          {STATUS[file.status].label}
        </span>
        <FileCounts file={file} size="text-[11px]" />
      </div>
      <div className="flex items-center gap-3 py-1 pr-4 font-mono text-xs" style={{ paddingLeft: '86px' }}>
        <span className="shrink-0 text-ink/25">{file.hunk.range}</span>
        <span className="truncate text-ink/45">{file.hunk.context}</span>
      </div>
      {file.hunk.lines.map((line, i) => (
        <NotedDiffLineRow key={i} line={line} />
      ))}
    </div>
  );
}

/** The document under a lens: a part's header pins over the files it claimed,
 *  and the summary the agent wrote for it sits under that. */
function DocPart({ part, at }: { part: (typeof LENS_PARTS)[number]; at: number }) {
  const enter = partEnter(at);
  return (
    <div className={`lens-part diff-list flex flex-col ${enter.className}`} style={enter.style}>
      <div className="pane-ledge-raised sticky top-0 z-20 bg-surface">
        <div className="w-full flex items-center gap-2 h-9 px-3">
          <Icon name="caret-down" className="shrink-0 !w-3 !h-3 text-ink/40" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">{part.title}</span>
        </div>
      </div>
      <p className="mx-6 max-w-[76ch] text-[12px] leading-relaxed text-ink/50">{part.summary}</p>
      {part.files.map((file) => (
        <DocFileCard key={file.name} file={file} />
      ))}
    </div>
  );
}

/** The same three files, read through a lens instead of the tree: the picker
 *  over the rail, the parts an agent grouped the change into, and the document
 *  in that order. `pPick` opens the picker and spends the run, `pParts` lands
 *  the grouping. */
function LensedDiffCard({ pPick, pParts }: { pPick: number; pParts: number }) {
  const written = pParts > 0.02;
  const menuOpen = pPick > 0.12 && pPick < 0.55;
  const writing = pPick >= 0.55 && !written;

  return (
    <div className="flex absolute inset-0 overflow-hidden bg-terminal-bg">
      <div className="shrink-0 flex flex-col overflow-hidden border-r border-bezel" style={{ width: RAIL_WIDTH }}>
        <div className="pane-ledge shrink-0 h-11 flex flex-col">
          <LensTrigger writing={writing} on={written} />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {written ? (
            LENS_PARTS.map((part, at) => {
              const enter = partEnter(at);
              return (
                <div key={part.title} className={`flex flex-col ${enter.className}`} style={enter.style}>
                  <div className="flex items-center gap-1.5 h-9 px-3 text-[12px] font-medium text-ink/90">
                    <span className="min-w-0 flex-1 truncate">{part.title}</span>
                    <Icon name="minus" className="shrink-0 !w-3 !h-3 opacity-50" />
                  </div>
                  <RailFiles files={part.files} />
                </div>
              );
            })
          ) : (
            <RailFiles files={FLAT_FILES} />
          )}
        </div>
      </div>
      {menuOpen && <LensMenu aimed={pPick > 0.34} />}
      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
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
          {written
            ? LENS_PARTS.map((part, at) => <DocPart key={part.title} part={part} at={at} />)
            : FLAT_FILES.map((file) => <DocFileCard key={file.name} file={file} />)}
        </div>
      </div>
    </div>
  );
}

/* ─── The section: what the history says, the loop, the lens ──────── */

const ANALYSIS_KEYS = ['scan', 'chip'] as const;
const LENS_KEYS = ['pick', 'parts'] as const;
const BEAT_KEYS = [...ANALYSIS_KEYS, ...LOOP_KEYS, ...LENS_KEYS] as const;

/**
 * The captions under the stage. What analysis reads and what you do about it
 * are one caption: the panel, the same reading inside the diff, and the note
 * that goes back to the agent are one story, and a caption swapping mid-play
 * reads as unrelated features.
 */
const CAPTIONS: { keys: readonly string[]; title: string; body: string; ms: number }[] = [
  {
    keys: [...ANALYSIS_KEYS, ...LOOP_KEYS],
    title: 'See and respond to code health issues',
    body: 'Hotspots help you identify complexity, churn, and ownership risk, then highlight those problems when they’re most actionable.',
    ms: 9000,
  },
  {
    keys: [...LENS_KEYS],
    title: 'Read a diff in chapters',
    body: 'A lens is a standing instruction your project keeps: lead with the decision, mechanical churn last. An agent applies it to any diff, in a worktree or a pull request, and regroups the change into named parts.',
    ms: 7000,
  },
];

/** The loop's unit. A beat's real length is this over its speed. */
const BEAT_MS = 5000;

/* Every beat inside a caption takes an equal share of that caption's time, so
   a caption spanning five beats gets more of them rather than the same time
   cut finer. The trailing entry is the hold before the loop restarts, which
   would otherwise sit a full beat at the end. */
const BEAT_SPEEDS = [
  ...CAPTIONS.flatMap((c) => Array<number>(c.keys.length).fill((BEAT_MS * c.keys.length) / c.ms)),
  2,
];

const TOTAL_MS = CAPTIONS.reduce((sum, c) => sum + c.ms, 0);

/** Where the dot bar sits: a caption owns the share of the bar its time on
 *  screen is worth, so the bar keeps one pace and still turns over exactly
 *  when the lit caption does. */
function captionProgress(t: number): number {
  let beat = 0;
  let ms = 0;
  for (const c of CAPTIONS) {
    const span = c.keys.length;
    if (t < beat + span) return (ms + ((t - beat) / span) * c.ms) / TOTAL_MS;
    beat += span;
    ms += c.ms;
  }
  return 1;
}

/** captionProgress inverted, for a reader who picks a spot on the bar. */
function progressToT(fraction: number): number {
  const target = clamp01(fraction) * TOTAL_MS;
  let beat = 0;
  let ms = 0;
  for (const c of CAPTIONS) {
    if (target < ms + c.ms) return beat + ((target - ms) / c.ms) * c.keys.length;
    beat += c.keys.length;
    ms += c.ms;
  }
  return BEAT_KEYS.length;
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
        {children}
        {/* Last and unstacked, so it covers the header it replaces but stays
            under the bevel, which `.glass-bevel::before` draws at z-index 1.
            Positioned inline because `.glass-bevel > *` pins every direct
            child to position relative, and would leave the strip in flow. */}
        {back && (
          <div
            className="bg-terminal-bg transition-opacity duration-200"
            style={{
              position: 'absolute',
              insetInline: 0,
              top: 0,
              opacity: !waiting && depth > 0 ? 1 : 0,
            }}
          >
            {back}
          </div>
        )}
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

/** The surfaces, in the order the run promotes them. The chip and the note
 *  are one surface: the reading opens in the split the note is written in, so
 *  the layout does not change under the reader between the two. */
const STACK = ['scan', 'chip', 'pick'] as const;

/** TerminalCardView's lift between one depth and the next. */
const DEPTH_STEP = 24;

/** The stage, and so the front card once the stack is at its deepest. */
const FRONT_HEIGHT = 520;
const STAGE_HEIGHT = FRONT_HEIGHT + (STACK.length - 1) * DEPTH_STEP;

export function ReviewSection() {
  const { rootRef, p, t, active, seek, paused, pauseAt, play } = useTheaterLoop(BEAT_KEYS, BEAT_MS, BEAT_SPEEDS);
  /* Which surface holds the front, taken as a step rather than a ramp: the
     depth change is the app's own animation, and a crossfade tied to the loop
     would leave two cards half-faded on top of each other. */
  const front = STACK.reduce((n, key, i) => (i > 0 && p(key) > 0.05 ? i : n), 0);
  const depth = (i: number) => (i <= front ? front - i : null);
  /* The tooltip is what the chip beat has to say; the note beat needs the
     line it covers. */
  const tip = front === 1 && p('note') < 0.05;

  return (
    /* The headline sits outside the theater, which centres what it holds. */
    <div>
      <h2 className="plan-v-headline">Review in depth</h2>
      <div ref={rootRef} className="bl-theater">
        <div className="plan-desk desk-wash desk-wash--prism" style={{ padding: 32, width: '100%' }}>
          <DeskWash />
          {/* The cards fill the stage whatever their number: the deepest one
              starts at its top edge, so the box the rest share gives up a step
              of height for every card that has arrived. */}
          <div className="relative" style={{ height: STAGE_HEIGHT }}>
            <div
              className="absolute inset-x-0 bottom-0"
              style={{ top: front * DEPTH_STEP, transition: 'top 0.25s ease' }}
            >
              <StackCard
                depth={depth(0)}
                back={<BackStrip icon="binoculars" label="Analysis" detail="850 commits · 318 files" />}
              >
                <MockAnalysis showAdvice />
              </StackCard>
              <StackCard depth={depth(1)}>
                <RoundTripTerminal p={p} depth={depth(1) ?? 0} tip={tip} />
              </StackCard>
              <StackCard depth={depth(2)}>
                <LensedDiffCard pPick={p('pick')} pParts={p('parts')} />
              </StackCard>
            </div>
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
        <BeatDots
          progress={captionProgress(t)}
          paused={paused}
          onPauseAt={(f) => pauseAt(progressToT(f))}
          onPlay={play}
        />
      </div>
    </div>
  );
}
