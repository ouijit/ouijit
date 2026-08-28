import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { MockAnalysis } from './MockAnalysis';
import { DeskWash } from './DeskWash';
import { NotedDiffPane, LensedDiffCard } from './ReviewLab';
import { useTheaterLoop, BeatDots } from './theaterLoop';

/**
 * Two compositions of the review section's material — the analysis panel, the
 * note that goes back to the agent, and the diff read through a lens — without
 * the theater's timeline. Both play a surface's own beat once as it arrives and
 * then leave it alone; neither loops, and neither has a transport.
 */

/** 0 → 1 once, the first time the block is well inside the viewport. The node
 *  is state rather than a ref: the observer is set up in an effect, which needs
 *  the render that attaches it. */
function useEnterProgress(ms: number): [(el: HTMLDivElement | null) => void, number] {
  const [progress, setProgress] = useState(0);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1);
      return;
    }
    let raf = 0;
    let start = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const step = (now: number) => {
          start ||= now;
          const p = Math.min(1, (now - start) / ms);
          setProgress(p);
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.35 },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [node, ms]);

  return [setNode, progress];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const span = (progress: number, from: number, to: number) => clamp01((progress - from) / (to - from));

const HEALTH_BEATS = ['advice', 'tip', 'note', 'send'] as const;

/**
 * What the history says and what you do about it, in one frame: the panel's
 * reading of a file, then the same reading on the file's own row in a diff, the
 * note written under it, and the note handed to the agent. Answering a hotspot
 * is the point of finding one, so the two are never apart.
 */
function HealthRun({ p }: { p: (k: string) => number }) {
  const answering = p('tip') > 0.02;
  /* Both fill the frame and cross over in it. Positioned inline because
     `.glass-bevel > *` pins every direct child to position relative. */
  const layer = (shown: boolean) => ({
    position: 'absolute' as const,
    inset: 0,
    opacity: shown ? 1 : 0,
    transition: 'opacity 300ms ease',
  });
  return (
    <>
      <div className="flex flex-col" style={layer(!answering)}>
        <MockAnalysis showAdvice />
      </div>
      <div style={layer(answering)}>
        <NotedDiffPane tip={p('tip') < 1} pNote={p('note')} pSend={p('send')} />
      </div>
    </>
  );
}

/** The beats off one run of progress, for a frame that plays once. */
function healthBeats(progress: number): (k: string) => number {
  return (k) =>
    k === 'advice'
      ? span(progress, 0, 0.24)
      : k === 'tip'
        ? span(progress, 0.24, 0.44)
        : k === 'note'
          ? span(progress, 0.42, 0.82)
          : span(progress, 0.84, 1);
}

/** The panel at the width the band gives it, not a window onto a wider one:
 *  these layouts reflow, so a narrower desk is a size the app can be rather
 *  than something to scale down or cut off. */
function Fit({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div
      className="rv-crop glass-bevel relative rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ height }}
    >
      {/* The panels scroll their own panes, and a wheel over one of them would
          be taken by the panel rather than the page. Nothing here is for
          clicking, so nothing here takes the pointer. */}
      {/* Inline, because `.glass-bevel > *` pins every direct child to
          position relative — which would collapse this to nothing. */}
      <div className="flex flex-col pointer-events-none" style={{ position: 'absolute', inset: 0 }}>
        {children}
      </div>
    </div>
  );
}

function Caption({ title, body }: { title: string; body: string }) {
  return (
    <div className="rv-caption">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

const COPY = {
  health: {
    title: 'See and respond to code health issues',
    body: 'Hotspots help you identify complexity, churn, and ownership risk, then highlight those problems when they’re most actionable.',
  },
  lens: {
    title: 'See diffs through a new lens',
    body: 'Keep an instruction like ‘lead with the decision, mechanical churn last’, and an agent regroups any diff into named parts.',
  },
};

/* ─── A: a strip you push through ────────────────────────────────── */

/** One height for every card, so the captions line up as the strip moves. Tall
 *  enough for the two panels that need it: the analysis panel opens scrolled to
 *  the foot of an expanded hotspot, and the chip's tooltip runs 330px down the
 *  well. */
const CARD_HEIGHT = 520;

/** A card in the strip: one panel at the width the app draws it, and the copy
 *  for it under the card rather than beside. */
function StripCard({
  title,
  body,
  wash,
  onRef,
  children,
}: {
  title: string;
  body: string;
  wash: string;
  onRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div className="rv-card" ref={onRef}>
      <div className={`rv-desk plan-desk desk-wash ${wash}`}>
        <DeskWash />
        <Fit height={CARD_HEIGHT}>
          <TerminalCardView isActive backDepth={0}>
            {children}
          </TerminalCardView>
        </Fit>
      </div>
      <Caption title={title} body={body} />
    </div>
  );
}

/**
 * One card at a time, side by side. The section is a viewport tall whatever it
 * holds, the panels keep the width the app draws them at, and the reader pushes
 * through them — no timeline, and nothing playing on its own.
 */
export function ReviewStrip() {
  const [healthRef, pHealth] = useEnterProgress(9000);
  const [lensRef, pLens] = useEnterProgress(2600);
  const strip = useRef<HTMLDivElement | null>(null);

  /* By a card and its gutter, so a push always lands on the next snap point. */
  const push = (dir: number) => {
    const el = strip.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? 0) + 28), behavior: 'smooth' });
  };

  return (
    <div>
      <div className="rv-strip-head">
        <h2 className="plan-v-headline">Review in depth</h2>
        <div className="rv-arrows">
          <button type="button" aria-label="Previous" onClick={() => push(-1)}>
            <Icon name="caret-left" />
          </button>
          <button type="button" aria-label="Next" onClick={() => push(1)}>
            <Icon name="caret-right" />
          </button>
        </div>
      </div>
      <div className="rv-strip" ref={strip}>
        <StripCard {...COPY.health} wash="desk-wash--prism-a" onRef={healthRef}>
          <HealthRun p={healthBeats(pHealth)} />
        </StripCard>
        <StripCard {...COPY.lens} wash="desk-wash--prism-c" onRef={lensRef}>
          <LensedDiffCard pPick={1} pParts={pLens} />
        </StripCard>
      </div>
    </div>
  );
}

/* ─── B: three bands, one topic at a time ─────────────────────────── */

/** A band: the surface at the size the app draws it, the copy for it in a
 *  column to its right, and that surface's own loop under the copy. Each band
 *  runs on its own clock — there is no order to read them in. */
function Chapter({
  title,
  body,
  beats,
  beatMs,
  height,
  surface,
}: {
  title: string;
  body: string;
  beats: readonly string[];
  beatMs: number;
  height: number;
  surface: (p: (k: string) => number) => ReactNode;
}) {
  const { rootRef, p, t, paused, pauseAt, play } = useTheaterLoop(beats, beatMs);

  return (
    <div className="rv-band" ref={rootRef}>
      <div className="rv-band-desk plan-desk desk-wash desk-wash--prism">
        <DeskWash />
        <Fit height={height}>
          <TerminalCardView isActive backDepth={0}>
            {surface(p)}
          </TerminalCardView>
        </Fit>
      </div>
      <div className="rv-band-copy">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="rv-band-dots">
          <BeatDots
            progress={clamp01(t / beats.length)}
            paused={paused}
            onPauseAt={(f) => pauseAt(f * beats.length)}
            onPlay={play}
          />
        </div>
      </div>
    </div>
  );
}

export function ReviewChapters() {
  return (
    <div>
      <h2 className="plan-v-headline">Review in depth</h2>
      <div className="rv-chapters">
        <Chapter
          {...COPY.health}
          beats={HEALTH_BEATS}
          beatMs={3200}
          height={520}
          surface={(p) => <HealthRun p={p} />}
        />
        <Chapter
          {...COPY.lens}
          beats={['pick', 'parts']}
          beatMs={3600}
          height={480}
          surface={(p) => <LensedDiffCard pPick={p('pick')} pParts={p('parts')} />}
        />
      </div>
    </div>
  );
}
