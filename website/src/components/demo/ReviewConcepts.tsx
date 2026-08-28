import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { MockAnalysis } from './MockAnalysis';
import { DeskWash } from './DeskWash';
import { RoundTripTerminal, LensedDiffCard } from './ReviewLab';
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
 * reading of a file, then the same reading on the file's own row in the diff
 * split against the session, the note written under it, and the note landing in
 * the agent's prompt. Answering a hotspot is the point of finding one, so the
 * two are never apart.
 */
function HealthRun({ p }: { p: (k: string) => number }) {
  const answering = p('tip') > 0.02;
  /* The session is already up when the diff opens beside it, and the run ends
     with the note in the prompt rather than following the agent's fix. */
  const beat = (k: string) => (k === 'scan' ? 1 : k === 'fix' ? 0 : p(k));
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
      <div className="flex flex-col" style={layer(answering)}>
        <RoundTripTerminal p={beat} depth={0} tip={p('tip') < 1} diffShare="56%" />
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

/**
 * The frame a panel is drawn in. Without `panelWidth` the panel takes the
 * frame's own width — these layouts reflow, so a narrower desk is a size the
 * app can be. With it, the panel is drawn at that width and the whole window
 * is scaled into the frame, which is how a column narrower than the panel
 * needs gets one that still reads: the type shrinks with everything else
 * rather than the lines wrapping.
 */
function Fit({ height, panelWidth, children }: { height: number; panelWidth?: number; children: ReactNode }) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = frame.current;
    if (!el || !panelWidth) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [panelWidth]);

  const scale = panelWidth && width ? width / panelWidth : 1;

  return (
    <div
      ref={frame}
      className="rv-crop glass-bevel relative rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ height }}
    >
      {/* The panels scroll their own panes, and a wheel over one of them would
          be taken by the panel rather than the page. Nothing here is for
          clicking, so nothing here takes the pointer. */}
      <div
        className="flex flex-col pointer-events-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: panelWidth ?? '100%',
          height: height / scale,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
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
    title: 'View diffs through a new lens',
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

/** The width a band's panel is drawn at, whatever the column comes to. Wide
 *  enough for the split — the diff and the session either side of it — which
 *  is the panel here that needs the most. */
const PANEL_WIDTH = 1000;

/** A band: the surface drawn at a window's size and scaled into the column, the
 *  copy for it to the right, and that surface's own loop under the copy. Each
 *  band runs on its own clock — there is no order to read them in. */
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
        <Fit height={height} panelWidth={PANEL_WIDTH}>
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
