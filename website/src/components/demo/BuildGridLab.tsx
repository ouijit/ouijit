import type { ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { DeskWash } from './DeskWash';
import { useTheaterLoop, BeatDots } from './theaterLoop';

/**
 * Build section lab, round 6 — parallelism as a grid that multiplies rather
 * than a stack that promotes. One tile per feature; the grid grows from the
 * first. Three stagings of the same tiles, to be picked between and then
 * built properly.
 */

interface Tile {
  key: string;
  icon: string;
  name: string;
  meta?: string;
  title: string;
  body: string;
  content: ReactNode;
}

const GREEN = 'text-ansi-green';

function Row({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return <div className={`truncate ${dim ? 'text-ink/35' : 'text-ink/70'}`}>{children}</div>;
}

const TILES: Tile[] = [
  {
    key: 'term',
    icon: 'terminal',
    name: 'claude',
    meta: 'T-101',
    title: 'Start isolated',
    body: 'Each task gets its own git worktree and terminal. The start hook launches your agent with the task’s prompt.',
    content: (
      <>
        <Row dim>$ claude &quot;$OUIJIT_TASK_DESCRIPTION&quot;</Row>
        <Row>› Split onboarding into a stepper.</Row>
        <Row dim>Read(src/onboarding/Stepper.tsx)</Row>
        <Row>
          <span className={GREEN}>+92</span> <span className="text-ink/40">/</span>{' '}
          <span className="text-diff-removed">−14</span> lines
        </Row>
      </>
    ),
  },
  {
    key: 'plan',
    icon: 'file-text',
    name: 'plan.md',
    title: 'Dock the plan',
    body: 'Any markdown file docks to a terminal as a live panel. For most tasks, that’s the plan.',
    content: (
      <>
        <Row>
          <Icon name="check" className={`inline !w-3 !h-3 mr-1.5 ${GREEN}`} />
          Stepper shell
        </Row>
        <Row>
          <Icon name="check" className={`inline !w-3 !h-3 mr-1.5 ${GREEN}`} />
          Saved progress
        </Row>
        <Row dim>
          <Icon name="circle-dashed" className="inline !w-3 !h-3 mr-1.5" />
          Retire WelcomeIntro
        </Row>
        <Row dim>
          <Icon name="circle-dashed" className="inline !w-3 !h-3 mr-1.5" />
          Update the e2e
        </Row>
      </>
    ),
  },
  {
    key: 'preview',
    icon: 'globe-simple',
    name: 'localhost:5173',
    title: 'Preview the app',
    body: 'A preview panel points at any URL. Aim one at the dev server and watch the branch run.',
    content: (
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="h-1.5 w-1/3 rounded-full bg-ink/25" />
        <div className="flex gap-1.5">
          <span className="h-6 flex-1 rounded bg-accent/25" />
          <span className="h-6 flex-1 rounded bg-ink/10" />
          <span className="h-6 flex-1 rounded bg-ink/10" />
        </div>
        <div className="h-1.5 w-2/3 rounded-full bg-ink/12" />
        <div className="h-1.5 w-1/2 rounded-full bg-ink/12" />
      </div>
    ),
  },
  {
    key: 'diff',
    icon: 'git-branch',
    name: '3 files',
    meta: '+130 −78',
    title: 'Follow the diff',
    body: 'Every change on the branch appears one tab over, as it happens.',
    content: (
      <>
        <Row dim>src/onboarding/Stepper.tsx</Row>
        <div className="px-1 bg-diff-added/10">
          <Row>
            <span className={GREEN}>+</span> const {'{'} step {'}'} = useProgress()
          </Row>
        </div>
        <div className="px-1 bg-diff-removed/[0.08]">
          <Row>
            <span className="text-diff-removed">−</span> useState(0)
          </Row>
        </div>
        <Row dim>WelcomeIntro.tsx −64</Row>
      </>
    ),
  },
  {
    key: 'status',
    icon: 'terminal',
    name: 'codex',
    meta: 'T-104',
    title: 'Track every session',
    body: 'Statuses show what each terminal is doing, and a notification lands the moment one finishes.',
    content: (
      <>
        <Row dim>npm test -- onboarding</Row>
        <Row>
          <span className={GREEN}>PASS</span> 14 tests in 2.1s
        </Row>
        <div className="mt-2 rounded-md border border-bezel bg-ink/[0.06] px-2 py-1.5">
          <Row>Ouijit · T-104 finished</Row>
        </div>
      </>
    ),
  },
];

const KEYS = TILES.map((t) => t.key);

function FeatureTile({ tile, lead = false }: { tile: Tile; lead?: boolean }) {
  return (
    <div
      className={`glass-bevel relative h-full flex flex-col rounded-[14px] overflow-hidden border ${
        lead ? 'border-accent/30' : 'border-bezel-panel'
      }`}
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <div className="pane-ledge relative z-[5] shrink-0 h-8 flex items-center gap-2 px-3">
        <Icon name={tile.icon} className="w-3.5 h-3.5 shrink-0 text-ink/50" />
        <span className="min-w-0 truncate text-[12px] text-ink/70">{tile.name}</span>
        {tile.meta && <span className="ml-auto shrink-0 font-mono text-[10px] text-ink/35">{tile.meta}</span>}
      </div>
      <div className="flex-1 min-h-0 p-3 flex flex-col gap-1 font-mono text-[11px] leading-[1.6] overflow-hidden">
        {tile.content}
      </div>
    </div>
  );
}

function BeatRow({ active, seek }: { active: number; seek: (i: number) => void }) {
  return (
    <div className="beat-row">
      {TILES.map((t, i) => (
        <button type="button" key={t.key} className={i === active ? 'is-active' : undefined} onClick={() => seek(i)}>
          <h3>{t.title}</h3>
          <p>{t.body}</p>
        </button>
      ))}
    </div>
  );
}

/* ═══ 6a · Mitosis — one tile splits, the grid reflows to fit each new one ═══ */

/** Tile width by how many are on the desk: the grid shrinks to make room,
 *  which is the whole read — one terminal becoming a fleet. */
const MITOSIS_WIDTH = [560, 380, 300, 300, 300];

export function VariantMitosis() {
  const { rootRef, progress, active, seek } = useTheaterLoop(KEYS);
  const count = active + 1;
  const width = MITOSIS_WIDTH[Math.min(count, MITOSIS_WIDTH.length) - 1];
  return (
    <div ref={rootRef} className="bl-theater">
      <div className="plan-desk desk-wash desk-wash--iris" style={{ padding: 32, width: '100%' }}>
        <DeskWash />
        <div
          className="relative flex flex-wrap items-stretch justify-center content-center gap-4"
          style={{ minHeight: 460 }}
        >
          {TILES.map((tile, i) => (
            <div
              key={tile.key}
              style={{
                width,
                height: 210,
                opacity: i < count ? 1 : 0,
                transform: `scale(${i < count ? 1 : 0.86})`,
                display: i < count ? undefined : 'none',
                transition: 'width 500ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 350ms ease, transform 350ms ease',
              }}
            >
              <FeatureTile tile={tile} lead={i === 0} />
            </div>
          ))}
        </div>
      </div>
      <BeatRow active={active} seek={seek} />
      <BeatDots progress={progress} />
    </div>
  );
}

/* ═══ 6b · Board fill — fixed slots, filling in reading order ═══ */

function EmptySlot() {
  return (
    <div className="flex items-center justify-center rounded-[14px] border border-dashed border-ink/12 text-ink/20">
      <Icon name="plus" className="w-5 h-5" />
    </div>
  );
}

export function VariantBoardFill() {
  const { rootRef, progress, active, seek } = useTheaterLoop(KEYS);
  const count = active + 1;
  return (
    <div ref={rootRef} className="bl-theater">
      <div className="plan-desk desk-wash desk-wash--iris" style={{ padding: 32, width: '100%' }}>
        <DeskWash />
        <div className="relative grid grid-cols-3 gap-4" style={{ gridAutoRows: 210 }}>
          {TILES.map((tile, i) =>
            i < count ? (
              <div key={tile.key} className="grid-tile-in">
                <FeatureTile tile={tile} lead={i === 0} />
              </div>
            ) : (
              <EmptySlot key={tile.key} />
            ),
          )}
          <EmptySlot />
        </div>
      </div>
      <BeatRow active={active} seek={seek} />
      <BeatDots progress={progress} />
    </div>
  );
}

/* ═══ 6c · Pull back — the camera retreats and the fleet comes into frame ═══ */

const ZOOM = [1.55, 1.15, 0.92, 0.82, 0.76];

export function VariantPullBack() {
  const { rootRef, progress, active, seek } = useTheaterLoop(KEYS);
  const count = active + 1;
  return (
    <div ref={rootRef} className="bl-theater">
      <div
        className="plan-desk desk-wash desk-wash--iris flex items-center justify-center"
        style={{ padding: 32, width: '100%', height: 560 }}
      >
        <DeskWash />
        <div
          className="relative grid grid-cols-3 gap-4"
          style={{
            gridAutoRows: 210,
            width: 940,
            transform: `scale(${ZOOM[Math.min(count, ZOOM.length) - 1]})`,
            transformOrigin: '16.7% 25%',
            transition: 'transform 600ms cubic-bezier(0.2, 0.7, 0.2, 1)',
          }}
        >
          {TILES.map((tile, i) => (
            <div
              key={tile.key}
              style={{
                opacity: i < count ? 1 : 0,
                transition: 'opacity 450ms ease',
              }}
            >
              <FeatureTile tile={tile} lead={i === 0} />
            </div>
          ))}
        </div>
      </div>
      <BeatRow active={active} seek={seek} />
      <BeatDots progress={progress} />
    </div>
  );
}
