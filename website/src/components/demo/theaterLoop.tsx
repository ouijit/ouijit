import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Timed replacement for the scroll-scrubbed theater: t advances one unit
 * per beat while the section is on screen, holds briefly after the last
 * beat, then loops from the top. Off-screen the loop pauses where it is;
 * reduced motion gets the finished state, frozen.
 *
 * `speeds` scales how long a beat takes without changing what a beat is —
 * t stays in beat units, so p, active and seek are untouched. Above 1 is
 * faster. One entry per beat, plus an optional last one for the hold before
 * the loop restarts. A caller whose captions span several beats each uses
 * this to give every caption the same time on screen. */
export function useTheaterLoop(keys: readonly string[], beatMs = 4500, speeds?: readonly number[]) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState(0);
  const accRef = useRef(0);
  const reducedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  /* Read inside the rAF loop, which must not be torn down and rebuilt every
     time the reader stops or starts it. */
  const pausedRef = useRef(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reducedRef.current = true;
      setT(keys.length);
      return;
    }
    const cycle = keys.length + 0.7;
    let visible = false;
    const io = new IntersectionObserver(([e]) => void (visible = e.isIntersecting), { threshold: 0.2 });
    if (rootRef.current) io.observe(rootRef.current);
    let raf = 0;
    let last = performance.now();
    let shown = -1;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (visible && !pausedRef.current) {
        const speed = speeds?.[Math.floor(accRef.current)] ?? 1;
        accRef.current = (accRef.current + (dt * speed) / beatMs) % cycle;
        const rounded = Math.round(accRef.current * 240);
        if (rounded !== shown) {
          shown = rounded;
          setT(accRef.current);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [keys.length, beatMs, speeds]);

  /* The 0.08 lead pre-arms each beat's opening thresholds so, with their
     CSS transitions, the visible change lands on the beat boundary instead
     of trailing the dot bar. */
  const p = (k: string) => {
    const i = keys.indexOf(k);
    if (i < 0) return 0;
    return clamp01((t - i + 0.08) / 0.8);
  };
  /* Jump to beat i; playback continues from there. Under reduced motion
     there is no playback, so land on the beat finished. */
  const seek = (i: number) => {
    if (reducedRef.current) {
      setT(i + 0.8);
      return;
    }
    accRef.current = i;
    setT(i);
  };
  const pauseAt = (i: number) => {
    seek(i);
    pausedRef.current = true;
    setPaused(true);
  };
  const play = () => {
    pausedRef.current = false;
    setPaused(false);
  };
  return {
    rootRef,
    p,
    /* Raw beat position, for a caller that draws its own progress: with
       captions spanning uneven numbers of beats, t/keys.length puts the bar
       somewhere its captions do not agree with. */
    t,
    progress: clamp01(t / keys.length),
    /* floor(t), so a beat is active from the instant it starts — a seek
       lights its column immediately instead of after the ramp threshold. */
    active: Math.min(Math.floor(t), keys.length - 1),
    seek,
    paused,
    pauseAt,
    play,
  };
}

/** The dots keep their spacing at any width, so the bar reads the same
 *  everywhere and a dot stays big enough to aim at. */
const DOT_PITCH = 18;

/** How far the pointer's pull reaches, in dots, and how much bigger a dot
 *  right under it gets. Size only — a dot that also moved would take its
 *  target with it. */
const SWELL_REACH = 2.2;
const SWELL_MAX = 1.9;

export function BeatDots({
  progress,
  paused,
  onPauseAt,
  onPlay,
}: {
  progress: number;
  paused: boolean;
  /** Fraction of the run to stop at. */
  onPauseAt: (fraction: number) => void;
  onPlay: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0);
  const [near, setNear] = useState(-1);
  /** Pointer position in dot units, or null once it has left the row. Held in
   *  a ref: the bend is written to the DOM rather than rendered. */
  const centerRef = useRef<number | null>(null);
  /** Where the row stays pulled with no pointer on it, so the dot the run is
   *  stopped at keeps the emphasis the pointer gave it. */
  const restRef = useRef<number | null>(null);
  const nearRef = useRef(-1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCount(Math.max(2, Math.round(e.contentRect.width / DOT_PITCH))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const swell = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const h = centerRef.current ?? restRef.current;
    const dots = el.children;
    for (let i = 0; i < dots.length; i++) {
      const mark = (dots[i] as HTMLElement).firstElementChild as HTMLElement;
      if (h === null) {
        mark.style.transform = '';
        continue;
      }
      const u = (i - h) / SWELL_REACH;
      mark.style.transform = `scale(${(1 + (SWELL_MAX - 1) * Math.exp(-u * u)).toFixed(3)})`;
    }
    const best = h === null ? -1 : Math.min(dots.length - 1, Math.max(0, Math.round(h)));
    if (best !== nearRef.current) {
      nearRef.current = best;
      setNear(best);
    }
  }, []);

  const track = useCallback(
    (clientX: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      centerRef.current = ((clientX - rect.left) / rect.width) * el.children.length - 0.5;
      swell();
    },
    [swell]
  );

  const head = Math.round(clamp01(progress) * (count - 1));

  useEffect(() => {
    restRef.current = paused ? head : null;
    if (centerRef.current === null) swell();
  }, [paused, head, count, swell]);

  /* A pointer affordance and nothing more: a stop per dot would put a hundred
     of them in the tab order and read a hundred labels out. The captions above
     are the keyboard way to the same beats. */
  /* The row takes the pointer, not the dots: a dot is 3px of a cell that is
     six times that, and only the row knows where its cells fall. */
  return (
    <div
      ref={ref}
      className="beat-dots"
      aria-hidden="true"
      onPointerMove={(e) => track(e.clientX, e.currentTarget)}
      onPointerLeave={() => {
        centerRef.current = null;
        swell();
      }}
      onClick={(e) => {
        track(e.clientX, e.currentTarget);
        const i = nearRef.current;
        if (i < 0) return;
        if (paused && i === head) onPlay();
        else onPauseAt(i / (count - 1));
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const atHead = paused && i === head;
        return (
          <span
            key={i}
            className={`beat-dot${i <= head ? ' is-lit' : ''}${atHead ? ' is-head' : ''}${
              i === near ? ' is-near' : ''
            }`}
          >
            <span className="beat-dot-mark" />
            <Icon name={atHead ? 'play-fill' : 'pause-fill'} className="beat-dot-icon" />
          </span>
        );
      })}
    </div>
  );
}
