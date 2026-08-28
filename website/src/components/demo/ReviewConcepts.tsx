import { useEffect, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { MockAnalysis } from './MockAnalysis';
import { DeskWash } from './DeskWash';
import { NotedDiffPane, LensedDiffCard } from './ReviewLab';

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

const span = (progress: number, from: number, to: number) => Math.min(1, Math.max(0, (progress - from) / (to - from)));

/**
 * One run of progress spread over the diff's answer to a hotspot: the tooltip
 * the chip carries, the note written on the line it points at, and the note
 * going to the agent. The theater spent three beats on this; here it is one
 * pass with no way back to the start.
 */
function RespondingDiff({ progress }: { progress: number }) {
  return (
    <NotedDiffPane
      tip={progress < 0.3}
      pNote={span(progress, 0.25, 0.78)}
      pSend={span(progress, 0.82, 1)}
    />
  );
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
 * Everything at once. Nothing is sequenced and nothing is cropped: a panel is
 * drawn at the width its row gives it, and the row is as wide as the panel
 * needs. The tiles carry the prism in gradient order, so the column still
 * reads as one sweep broken into panels.
 */
export function ReviewBento() {
  const [respondRef, pRespond] = useEnterProgress(5200);
  const [lensRef, pLens] = useEnterProgress(2600);

  return (
    <div>
      <h2 className="plan-v-headline">Review in depth</h2>
      <div className="rv-bento">
        <div className="rv-tile" ref={respondRef}>
          <div className="rv-desk plan-desk desk-wash desk-wash--prism-a">
              <DeskWash />
            {/* Tall enough for the whole expanded hotspot: `showAdvice` opens
                the panel scrolled to the foot of it, and a shorter frame cuts
                the head of the entry off. */}
            <Fit height={520}>
              <TerminalCardView isActive backDepth={0}>
                <MockAnalysis showAdvice />
              </TerminalCardView>
            </Fit>
          </div>
          <div className="rv-desk plan-desk desk-wash desk-wash--prism-b">
            <DeskWash />
            {/* The chip's tooltip opens into the well and runs 330px down it,
                so a shorter frame cuts the foot of the reading off. */}
            <Fit height={500}>
              <TerminalCardView isActive backDepth={0}>
                <RespondingDiff progress={pRespond} />
              </TerminalCardView>
            </Fit>
          </div>
          <Caption {...COPY.health} />
        </div>

        <div className="rv-tile" ref={lensRef}>
          <div className="rv-desk plan-desk desk-wash desk-wash--prism-c">
            <DeskWash />
            <Fit height={480}>
              <TerminalCardView isActive backDepth={0}>
                <LensedDiffCard pPick={1} pParts={pLens} />
              </TerminalCardView>
            </Fit>
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
  onRef,
  children,
}: {
  title: string;
  body: string;
  flip?: boolean;
  height: number;
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
        <Fit height={height}>
          <TerminalCardView isActive backDepth={0}>
            {children}
          </TerminalCardView>
        </Fit>
      </div>
    </div>
  );
}

export function ReviewChapters() {
  const [respondRef, pRespond] = useEnterProgress(5200);
  const [lensRef, pLens] = useEnterProgress(2600);

  return (
    <div>
      <h2 className="plan-v-headline">Review in depth</h2>
      <div className="rv-chapters">
        <Chapter {...COPY.health} height={520}>
          <MockAnalysis showAdvice />
        </Chapter>
        <Chapter {...COPY.notes} flip height={500} onRef={respondRef}>
          <RespondingDiff progress={pRespond} />
        </Chapter>
        <Chapter {...COPY.lens} height={480} onRef={lensRef}>
          <LensedDiffCard pPick={1} pParts={pLens} />
        </Chapter>
      </div>
    </div>
  );
}
