import { useMemo } from 'react';
import { projectIconColor } from '../utils/projectIcon';
import { SidebarTooltipWrapper, SidebarTile } from './SidebarTooltip';
import { useAppStore, selectCloneJob } from '../stores/appStore';
import type { CloneJob } from '../types';

/** A project that is still arriving: no drag and no context menu. */
export function CloningProjectIcon({
  projectPath,
  isActive,
  onClick,
}: {
  projectPath: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const job = useAppStore(useMemo(() => selectCloneJob(projectPath), [projectPath]));
  if (!job) return null;
  const failed = job.status === 'failed';

  return (
    <SidebarTooltipWrapper label={`${job.name} — ${cloneSummary(job)}`}>
      {(tipRef, tipProps) => (
        <div
          ref={tipRef}
          {...tipProps}
          className="group relative flex items-center justify-center shrink-0 [-webkit-app-region:no-drag]"
          style={{ width: 'var(--sidebar-width)', height: 48 }}
          onClick={onClick}
        >
          <SidebarTile
            name={job.name}
            color={projectIconColor({ name: job.name })}
            isActive={isActive}
            opacity={failed ? 0.35 : 0.5}
          >
            <CloneRing percent={job.percent} failed={failed} />
          </SidebarTile>
        </div>
      )}
    </SidebarTooltipWrapper>
  );
}

function cloneSummary(job: CloneJob): string {
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
        strokeDashoffset={indeterminate || failed ? undefined : 1 - (percent ?? 0) / 100}
        style={{
          transition: indeterminate ? undefined : 'stroke-dashoffset 200ms linear',
          animation: indeterminate ? 'clone-ring-sweep 1.4s linear infinite' : undefined,
        }}
      />
    </svg>
  );
}
