import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  useHover,
  useDismiss,
  useRole,
  useInteractions,
} from '@floating-ui/react';
import { projectIconColor, getInitials } from '../utils/projectIcon';
import type { CloneJob } from '../types';

/**
 * A project that is still arriving. Inert by design — no drag, no context
 * menu, nothing that acts on a directory which is not there yet. Clicking it
 * opens the clone's own view, which is where cancelling lives.
 */
export function CloningProjectIcon({
  job,
  isActive,
  onClick,
}: {
  job: CloneJob;
  isActive: boolean;
  onClick: () => void;
}) {
  const [tipOpen, setTipOpen] = useState(false);
  const {
    refs: tipRefs,
    floatingStyles: tipStyles,
    context: tipContext,
  } = useFloating({
    open: tipOpen,
    onOpenChange: setTipOpen,
    placement: 'right',
    strategy: 'fixed',
    middleware: [offset(-4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(tipContext, { move: false, delay: { open: 100 } }),
    useDismiss(tipContext),
    useRole(tipContext, { role: 'tooltip' }),
  ]);

  const failed = job.status === 'failed';

  return (
    <>
      <div
        ref={tipRefs.setReference}
        {...getReferenceProps()}
        className="group relative flex items-center justify-center shrink-0 [-webkit-app-region:no-drag]"
        style={{ width: 'var(--sidebar-width)', height: 48 }}
        data-cloning-path={job.projectPath}
        onClick={onClick}
      >
        <div
          className={`absolute left-0 w-1 rounded-r-sm bg-ink transition-all duration-200 ease-out ${
            isActive ? 'h-9 opacity-100' : 'h-0 opacity-0 group-hover:h-5 group-hover:opacity-50'
          }`}
        />
        <div className="w-10 h-10 overflow-hidden rounded-md">
          <div
            className="w-full h-full flex items-center justify-center text-sm font-bold text-white"
            style={{
              backgroundColor: projectIconColor({ name: job.name }),
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
              // Held back until it is real, so a full-strength tile always
              // means a project you can open.
              opacity: failed ? 0.35 : 0.5,
            }}
          >
            {getInitials(job.name)}
          </div>
        </div>
        <CloneRing percent={job.percent} failed={failed} />
      </div>
      {tipOpen &&
        createPortal(
          <div
            ref={tipRefs.setFloating}
            style={tipStyles}
            {...getFloatingProps()}
            className="z-[10003] px-2 py-1 rounded-md text-xs text-text-primary glass-bevel border border-bezel pointer-events-none"
          >
            {failed ? `${job.name} — clone failed` : `${job.name} — ${cloneSummary(job)}`}
          </div>,
          document.body,
        )}
    </>
  );
}

export function cloneSummary(job: CloneJob): string {
  if (job.status === 'failed') return 'Clone failed';
  return job.percent === null ? `${job.phase}…` : `${job.phase} ${job.percent}%`;
}

/**
 * The sidebar tile is 40px across with a 12px corner radius. Offsetting a
 * rounded rect outward by d adds d to its radius — that is what keeps the two
 * curves concentric, and getting it wrong is immediately visible as a ring
 * whose corners do not follow the icon's.
 */
const TILE_SIZE = 40;
const TILE_RADIUS = 12;
const RING_GAP = 2;
const RING_STROKE = 2;
const RING_SIZE = TILE_SIZE + RING_GAP * 2;
const RING_RADIUS = TILE_RADIUS + RING_GAP;
const RING_BOX = RING_SIZE + RING_STROKE;

/**
 * Traces the tile's own silhouette rather than ringing it with a circle.
 * `pathLength` renormalizes the perimeter to 1, so the dash offset is the
 * fraction remaining whatever the geometry works out to, and the sweep runs at
 * a constant speed along the edge instead of accelerating down the sides.
 */
function CloneRing({ percent, failed }: { percent: number | null; failed: boolean }) {
  const indeterminate = percent === null && !failed;
  const shape = {
    x: RING_STROKE / 2,
    y: RING_STROKE / 2,
    width: RING_SIZE,
    height: RING_SIZE,
    rx: RING_RADIUS,
    pathLength: 1,
    strokeWidth: RING_STROKE,
  };
  return (
    <svg
      className="absolute pointer-events-none"
      width={RING_BOX}
      height={RING_BOX}
      viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
      fill="none"
    >
      <rect {...shape} stroke="var(--color-border)" />
      <rect
        {...shape}
        stroke={failed ? 'var(--color-error)' : 'var(--color-accent)'}
        strokeLinecap="round"
        strokeDasharray={indeterminate ? '0.25 0.75' : '1'}
        strokeDashoffset={indeterminate ? undefined : 1 - (failed ? 1 : (percent ?? 0)) / 100}
        style={{
          transition: indeterminate ? undefined : 'stroke-dashoffset 200ms linear',
          animation: indeterminate ? 'clone-ring-sweep 1.4s linear infinite' : undefined,
        }}
      />
    </svg>
  );
}
