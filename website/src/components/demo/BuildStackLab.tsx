import { useEffect, useRef, useState } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { DeskWash } from './DeskWash';

/**
 * Build section lab, round 10 — the app's own terminal stack, one card to five,
 * on an iris desk. No new visual language: the chrome, the depth ramp, and the
 * peek above each back card are the ones the product already draws.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const SESSIONS = [
  { task: 'T-101', label: 'Rework onboarding flow', osc: 'Editing onboarding stepper…', state: 'thinking' },
  { task: 'T-102', label: 'Wire payment retries', osc: 'Reading dunningQueue.ts…', state: 'thinking' },
  { task: 'T-103', label: 'Polish invitation email', osc: 'done · 14 passed', state: 'ready' },
  { task: 'T-104', label: 'Speed up search index', osc: 'Running npm test…', state: 'thinking' },
  { task: 'T-105', label: 'Add CSV export', osc: 'Writing toCsv.ts…', state: 'thinking' },
];

const N = SESSIONS.length;

/** The stack's own geometry: what a back card peeks above the one in front,
 *  and how much it narrows. The app caps its depth ramp at four cards, so a
 *  ten-deep stack supplies its own rather than repeating the fourth. */
const PEEK = 24;
/** Headroom above the deepest card, so the stack never touches the desk. */
const TOP_PAD = 76;
const NARROW = 0.014;

function useStageScrub() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState(0);
  const last = useRef(-1);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const next = span > 0 ? clamp01(-rect.top / span) : 0;
      const rounded = Math.round(next * 1000);
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

  return { wrapRef, t };
}

function useStaticMode() {
  const [staticMode, setStaticMode] = useState(false);
  useEffect(() => {
    const queries = [window.matchMedia('(max-width: 860px)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
    const update = () => setStaticMode(queries.some((q) => q.matches));
    update();
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return staticMode;
}

function FrontSession() {
  return (
    <div className="flex-1 min-h-0 p-5 flex flex-col gap-2 font-mono text-[12.5px] leading-[1.7] overflow-hidden">
      <div className="text-ink/35">$ claude &quot;$OUIJIT_TASK_DESCRIPTION&quot;</div>
      <div className="text-ink/75">› Split onboarding into a three-step stepper with saved progress.</div>
      <div className="text-ink/50">I&rsquo;ll read the existing component first, then split it.</div>
      <div className="text-ink/35">Read(src/onboarding/Stepper.tsx) → 142 lines</div>
      <div className="text-ink/35">Write(plan.md) → +24 lines</div>
      <div className="text-ink/35">Edit(src/onboarding/Stepper.tsx)</div>
      <div>
        <span className="text-ansi-green">+92</span> <span className="text-ink/30">/</span>{' '}
        <span className="text-diff-removed">−14</span> <span className="text-ink/55">lines</span>
      </div>
      <div className="mt-auto flex items-center gap-2 text-ink/30">
        <span className="stk-caret" />
        Type a follow-up…
      </div>
    </div>
  );
}

/* ─── The stage ───────────────────────────────────────────────────── */

export function VariantStack() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const grown = staticMode ? N : 1 + easeOut(clamp01(t / 0.9)) * (N - 1);

  return (
    <div ref={wrapRef} style={{ height: staticMode ? 'auto' : '340vh' }}>
      <div className="stk-sticky">
        <div className="plan-desk desk-wash desk-wash--iris stk-desk">
          <DeskWash />
          {/* The well starts one peek lower per back card and the cards fill
              what is left, so the front card gives up height as the stack
              deepens — the same trade the app's stack container makes. */}
          <div className="stk-well" style={{ top: TOP_PAD + (grown - 1) * PEEK }}>
            {SESSIONS.map((session, i) => {
              const arrive = staticMode ? 1 : clamp01(grown - i);
              if (arrive <= 0) return null;
              const front = i === 0;
              return (
                <div
                  key={session.task}
                  className="stk-card"
                  style={{
                    zIndex: N - i,
                    opacity: arrive,
                    transform: `translateY(${-i * PEEK * arrive}px) scaleX(${1 - i * NARROW * arrive})`,
                  }}
                >
                  <TerminalCardView isActive={front}>
                    <TerminalHeaderView
                      summaryType={session.state}
                      isActive={front}
                      isBackCard={!front}
                      stackPosition={front ? undefined : i}
                      nameContent={
                        <TerminalHeaderName
                          label={front ? 'claude' : session.label}
                          lastOscTitle={front ? 'Editing onboarding stepper…' : session.osc}
                        />
                      }
                      branchContent={
                        front ? (
                          <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink/45">
                            <Icon name="git-branch" className="w-3 h-3" />
                            rework-onboarding
                          </span>
                        ) : undefined
                      }
                    />
                    {front && <FrontSession />}
                  </TerminalCardView>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
