import { useEffect, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { MockAnalysis } from './MockAnalysis';
import { DeskWash } from './DeskWash';
import { RoundTripTerminal, LensedDiffCard } from './ReviewLab';

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

/** The loop's beats off one run of progress, so a surface built for the
 *  theater can be handed a block that only plays once. */
function loopBeats(progress: number): (k: string) => number {
  const span = (from: number, to: number) => Math.min(1, Math.max(0, (progress - from) / (to - from)));
  return (k) => (k === 'scan' ? 1 : k === 'note' ? span(0, 0.4) : k === 'send' ? span(0.4, 0.55) : span(0.55, 1));
}

/**
 * A surface at the size it was drawn, shown through a window smaller than it.
 * The panels are laid out for a 1180px stage and their type is sized for that,
 * so a tile shows a region of one — `x` and `y` into the panel, `scale` a nudge
 * rather than a fit — instead of shrinking the whole thing past reading.
 */
function Crop({
  height,
  scale,
  x = 0,
  y = 0,
  panel = { w: 1180, h: 520 },
  children,
}: {
  height: number;
  scale: number;
  x?: number;
  y?: number;
  panel?: { w: number; h: number };
  children: ReactNode;
}) {
  return (
    <div
      className="rv-crop glass-bevel relative rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ height }}
    >
      <div
        className="absolute top-0 left-0 flex flex-col"
        style={{
          width: panel.w,
          height: panel.h,
          transform: `translate(${-x * scale}px, ${-y * scale}px) scale(${scale})`,
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
  notes: {
    title: 'Send notes back to the agent',
    body: 'Leave a note on any changed line. They stay with the worktree until you hand the lot to the agent working in it.',
  },
  lens: {
    title: 'See diffs through a new lens',
    body: 'Keep an instruction like ‘lead with the decision, mechanical churn last’, and an agent regroups any diff into named parts.',
  },
};

/* ─── A: three tiles, no time axis ────────────────────────────────── */

/**
 * Everything at once. The three surfaces are sized against each other rather
 * than sequenced — the reader picks where to look, and nothing has to be
 * waited for. Each tile carries a third of the prism, in gradient order, so
 * the row still reads as one sweep broken into panels.
 */
export function ReviewBento() {
  const [notesRef, pNotes] = useEnterProgress(4200);
  const [lensRef, pLens] = useEnterProgress(2600);

  return (
    <div>
      <h2 className="plan-v-headline">Review in depth</h2>
      <div className="rv-bento">
        <div className="rv-tile">
          <div className="rv-desk plan-desk desk-wash desk-wash--prism-a">
            <DeskWash />
            <Crop height={340} scale={0.86} x={190}>
              <div className="flex-1 min-h-0 flex flex-col">
                <TerminalCardView isActive backDepth={0}>
                  <MockAnalysis showAdvice />
                </TerminalCardView>
              </div>
            </Crop>
          </div>
          <Caption {...COPY.health} />
        </div>

        <div className="rv-tile" ref={notesRef}>
          <div className="rv-desk plan-desk desk-wash desk-wash--prism-b">
            <DeskWash />
            <Crop height={340} scale={0.86} x={560} y={40}>
              <div className="flex-1 min-h-0 flex flex-col">
                <TerminalCardView isActive backDepth={0}>
                  <RoundTripTerminal p={loopBeats(pNotes)} depth={0} />
                </TerminalCardView>
              </div>
            </Crop>
          </div>
          <Caption {...COPY.notes} />
        </div>

        <div className="rv-tile rv-tile--wide" ref={lensRef}>
          <div className="rv-desk plan-desk desk-wash desk-wash--prism-c">
            <DeskWash />
            <Crop height={430} scale={0.92}>
              <div className="flex-1 min-h-0 flex flex-col">
                <TerminalCardView isActive backDepth={0}>
                  <LensedDiffCard pPick={1} pParts={pLens} />
                </TerminalCardView>
              </div>
            </Crop>
          </div>
          <Caption {...COPY.lens} />
        </div>
      </div>
    </div>
  );
}

/* ─── B: three bands, one topic at a time ─────────────────────────── */

/** A band: copy on one side, the surface on the other, at the size the app
 *  draws it. The side alternates down the section. */
function Chapter({
  title,
  body,
  flip,
  height,
  scale,
  onRef,
  children,
}: {
  title: string;
  body: string;
  flip?: boolean;
  height: number;
  scale: number;
  onRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div className={`rv-band${flip ? ' rv-band--flip' : ''}`} ref={onRef}>
      <div className="rv-band-copy">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="rv-band-desk plan-desk desk-wash desk-wash--prism">
        <DeskWash />
        <Crop height={height} scale={scale}>
          <div className="flex-1 min-h-0 flex flex-col">
            <TerminalCardView isActive backDepth={0}>
              {children}
            </TerminalCardView>
          </div>
        </Crop>
      </div>
    </div>
  );
}

export function ReviewChapters() {
  const [notesRef, pNotes] = useEnterProgress(4200);
  const [lensRef, pLens] = useEnterProgress(2600);

  return (
    <div>
      <h2 className="plan-v-headline">Review in depth</h2>
      <div className="rv-chapters">
        <Chapter {...COPY.health} height={380} scale={0.78}>
          <MockAnalysis showAdvice />
        </Chapter>
        <Chapter {...COPY.notes} flip height={420} scale={0.78} onRef={notesRef}>
          <RoundTripTerminal p={loopBeats(pNotes)} depth={0} />
        </Chapter>
        <Chapter {...COPY.lens} height={420} scale={0.78} onRef={lensRef}>
          <LensedDiffCard pPick={1} pParts={pLens} />
        </Chapter>
      </div>
    </div>
  );
}
