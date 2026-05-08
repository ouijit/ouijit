import { useEffect, useRef, useState } from 'react';

export default function CompareSlider() {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const pointerIdRef = useRef<number | null>(null);

  const setSplitFromX = (clientX: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSplit(pct);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const keyframes = [
      { split: 50, at: 0 },
      { split: 45, at: 400 },
      { split: 55, at: 900 },
      { split: 50, at: 1400 },
    ];
    const start = performance.now() + 700;
    let raf = 0;
    const tick = (now: number) => {
      if (pointerIdRef.current !== null) return;
      const t = now - start;
      if (t < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      let current = 50;
      for (let i = 0; i < keyframes.length - 1; i++) {
        const a = keyframes[i];
        const b = keyframes[i + 1];
        if (t >= a.at && t <= b.at) {
          const p = (t - a.at) / (b.at - a.at);
          const eased = 0.5 - 0.5 * Math.cos(Math.PI * p);
          current = a.split + (b.split - a.split) * eased;
          break;
        }
      }
      setSplit(current);
      if (t < keyframes[keyframes.length - 1].at) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={sliderRef}
      className={`compare-slider${isDragging ? ' is-dragging' : ''}`}
      style={{ ['--split' as string]: `${split}%` } as React.CSSProperties}
      onPointerDown={(e) => {
        pointerIdRef.current = e.pointerId;
        sliderRef.current?.setPointerCapture(e.pointerId);
        setIsDragging(true);
        setSplitFromX(e.clientX);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointerIdRef.current) return;
        setSplitFromX(e.clientX);
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== pointerIdRef.current) return;
        try {
          sliderRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        pointerIdRef.current = null;
        setIsDragging(false);
      }}
      onPointerCancel={(e) => {
        if (e.pointerId !== pointerIdRef.current) return;
        pointerIdRef.current = null;
        setIsDragging(false);
      }}
    >
      <img className="compare-left" src="/assets/screenshots/kanban.png" alt="Kanban board" draggable={false} />
      <img
        className="compare-right"
        src="/assets/screenshots/terminal-stack.png"
        alt="Terminal stack"
        draggable={false}
      />
      <button className="compare-handle" aria-label="Drag to compare views" type="button" />
    </div>
  );
}
