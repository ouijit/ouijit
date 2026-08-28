import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';

/**
 * The Analysis panel from the app, rendered from fixtures: hotspots over the
 * last twelve months, the module tree, coupled pairs, and who holds the code.
 * Class strings are lifted from the app components so the two stay comparable
 * side by side.
 */

interface Signal {
  path: string;
  commits: number;
  monthly: number[];
  trend: { direction: 'new' | 'rising' | 'steady' | 'cooling'; recent: number };
  freqRank: number;
  cxRank: number;
  loc: number;
  changed: number;
  nesting: string;
  authors: Array<{ name: string; share: number }>;
  partner?: { path: string; degree: number };
  levers: Array<{ icon: string; text: string }>;
}

const HOTSPOTS: Signal[] = [
  {
    path: 'src/billing/webhookRouter.ts',
    commits: 68,
    monthly: [4, 3, 6, 5, 4, 7, 5, 6, 8, 6, 7, 7],
    trend: { direction: 'rising', recent: 20 },
    freqRank: 0.98,
    cxRank: 0.94,
    loc: 612,
    changed: 3410,
    nesting: 'nests 7 deep, 2.4 on average',
    authors: [
      { name: 'prentice', share: 0.61 },
      { name: 'mara-oduya', share: 0.24 },
      { name: 'jkataja', share: 0.1 },
    ],
    partner: { path: 'src/billing/dunningQueue.ts', degree: 0.78 },
    levers: [
      { icon: 'square-split-horizontal', text: 'Large and still changing · worth splitting' },
      { icon: 'tree-structure', text: 'Nests deeply · worth flattening the worst path' },
      { icon: 'git-fork', text: 'Usually changes with dunningQueue.ts · worth checking the seam' },
    ],
  },
  {
    path: 'src/search/indexBuilder.ts',
    commits: 41,
    monthly: [2, 1, 3, 2, 4, 3, 5, 4, 3, 5, 4, 5],
    trend: { direction: 'rising', recent: 14 },
    freqRank: 0.91,
    cxRank: 0.83,
    loc: 388,
    changed: 2140,
    nesting: 'nests 6 deep, 2.1 on average',
    authors: [
      { name: 'mara-oduya', share: 0.84 },
      { name: 'prentice', share: 0.11 },
    ],
    partner: { path: 'src/search/tokenizer.ts', degree: 0.64 },
    levers: [
      { icon: 'tree-structure', text: 'Nests deeply · worth flattening the worst path' },
      { icon: 'user-circle', text: 'Held by one author · worth a second reader' },
    ],
  },
  {
    path: 'src/onboarding/Stepper.tsx',
    commits: 34,
    monthly: [0, 0, 2, 1, 3, 2, 4, 3, 4, 5, 5, 5],
    trend: { direction: 'rising', recent: 15 },
    freqRank: 0.86,
    cxRank: 0.58,
    loc: 244,
    changed: 1580,
    nesting: 'nests 5 deep, 1.9 on average',
    authors: [
      { name: 'prentice', share: 0.52 },
      { name: 'jkataja', share: 0.29 },
      { name: 'mara-oduya', share: 0.13 },
    ],
    partner: { path: 'src/account/preferences.ts', degree: 0.71 },
    levers: [
      { icon: 'arrows-clockwise', text: 'Rewritten many times over · the interface may not have settled' },
      { icon: 'git-fork', text: 'Usually changes with preferences.ts · worth checking the seam' },
    ],
  },
  {
    path: 'src/invoices/InvoicesTable.tsx',
    commits: 29,
    monthly: [5, 4, 3, 4, 2, 3, 2, 2, 1, 2, 1, 0],
    trend: { direction: 'cooling', recent: 3 },
    freqRank: 0.79,
    cxRank: 0.72,
    loc: 431,
    changed: 1120,
    nesting: 'nests 5 deep, 2.0 on average',
    authors: [
      { name: 'jkataja', share: 0.55 },
      { name: 'prentice', share: 0.3 },
    ],
    levers: [{ icon: 'minus-circle', text: 'Cooling off · probably best left alone' }],
  },
];

const MODULES = [
  {
    path: 'src',
    share: 0.72,
    files: 214,
    hotspots: 4,
    commits: 612,
    trend: 'rising' as const,
    children: [
      { path: 'src/billing', share: 0.31, files: 38, hotspots: 2, commits: 190, trend: 'rising' as const },
      { path: 'src/onboarding', share: 0.19, files: 24, hotspots: 1, commits: 116, trend: 'rising' as const },
      { path: 'src/search', share: 0.16, files: 31, hotspots: 1, commits: 98, trend: 'steady' as const },
      { path: 'src/invoices', share: 0.12, files: 27, hotspots: 0, commits: 74, trend: 'cooling' as const },
    ],
  },
  { path: 'app', share: 0.18, files: 63, hotspots: 0, commits: 153, trend: 'steady' as const, children: [] },
  { path: 'server', share: 0.1, files: 41, hotspots: 0, commits: 85, trend: 'cooling' as const, children: [] },
];

const MODULE_COUPLINGS = [
  { a: 'src/billing', b: 'server/webhooks', degree: 0.74, shared: 41 },
  { a: 'src/onboarding', b: 'src/account', degree: 0.62, shared: 27 },
];

const FILE_COUPLINGS = [
  { a: 'src/billing/webhookRouter.ts', b: 'src/billing/dunningQueue.ts', degree: 0.78, shared: 34 },
  { a: 'src/onboarding/Stepper.tsx', b: 'src/account/preferences.ts', degree: 0.71, shared: 19 },
  { a: 'src/search/indexBuilder.ts', b: 'src/search/tokenizer.ts', degree: 0.64, shared: 16 },
];

const OWNERS = [
  { name: 'prentice', mainOf: 96, share: 0.44 },
  { name: 'mara-oduya', mainOf: 61, share: 0.28 },
  { name: 'jkataja', mainOf: 43, share: 0.2 },
];

const PROJECT_MONTHLY = [58, 47, 62, 51, 74, 66, 71, 83, 69, 88, 79, 92];
const MONTH_LABELS = ['Sep 2025', 'Oct', 'Nov', 'Dec', 'Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug 2026'];
/** The tail the app reads as "recent" — TREND_RECENT_MONTHS of twelve. */
const RECENT_CUT = 9;

const topPercent = (rank: number) => `top ${Math.max(1, Math.round((1 - rank) * 100))}%`;
const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirname = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/**
 * The panel runs taller than the frames it appears in. `showAdvice` opens it
 * already scrolled to the foot of the expanded hotspot, where its
 * recommendations are, rather than at the top of the list. Measured rather
 * than given, since that entry is as tall as its own history.
 */
export function MockAnalysis({ showAdvice }: { showAdvice?: boolean } = {}) {
  const scroller = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const pane = scroller.current;
    if (!showAdvice || !pane) return;
    const pin = () => {
      const detail = pane.querySelector<HTMLElement>('[data-hotspot-detail]');
      if (detail) pane.scrollTop += detail.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom;
    };
    /* Again on every resize: the browser clamps scrollTop when the pane
       shrinks, and does not put it back when the pane grows again. */
    const observer = new ResizeObserver(pin);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [showAdvice]);

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-2 px-4">
        <Icon name="binoculars" className="w-4 h-4 text-git/80" />
        <span className="text-[13px] font-medium text-text-primary">Analysis</span>
        <span className="ml-auto text-[11px] text-text-tertiary truncate">
          850 commits · 318 files · last 12 months
        </span>
        <span className="ml-2 text-text-tertiary [&>svg]:w-3.5 [&>svg]:h-3.5">
          <Icon name="arrows-clockwise" />
        </span>
      </div>

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-7">
          <div className="flex items-center gap-3">
            <span className="w-40 shrink-0">
              <Sparkline monthly={PROJECT_MONTHLY} className="h-6" />
            </span>
            <span className="text-[12px] text-text-secondary">Rising · 259 of 850 commits in the last 3 months</span>
          </div>

          <Section label="Hotspots" count={HOTSPOTS.length} defaultOpen>
            {HOTSPOTS.map((signal, i) => (
              <HotspotEntry key={signal.path} signal={signal} defaultOpen={i === 0} />
            ))}
          </Section>

          <Section label="Modules" count={MODULES.length} defaultOpen>
            {MODULES.map((node, i) => (
              <ModuleRow key={node.path} node={node} depth={0} defaultOpen={i === 0} />
            ))}
          </Section>

          <Section label="Coupled modules" count={MODULE_COUPLINGS.length}>
            {MODULE_COUPLINGS.map((pair) => (
              <CouplingRow key={pair.a} pair={pair} directories />
            ))}
          </Section>

          <Section label="Coupled files" count={FILE_COUPLINGS.length}>
            {FILE_COUPLINGS.map((pair) => (
              <CouplingRow key={pair.a} pair={pair} />
            ))}
          </Section>

          <Section label="Knowledge" count={OWNERS.length}>
            {OWNERS.map((owner) => (
              <OwnerRow key={owner.name} {...owner} />
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

/**
 * The chip's tooltip from the app's diff panel — the same reading the Analysis
 * panel gives a file, on the file itself. Tooltip chrome included, since the
 * demo has no hover to open it with.
 */
export function HotspotTip({ path }: { path: string }) {
  const signal = HOTSPOTS.find((s) => s.path === path) ?? HOTSPOTS[0];
  /* The seam advice is the partner line below, so the lever repeating it goes.
     The app drops it by handing the chip no partner. */
  const levers = signal.levers.filter((lever) => lever.icon !== 'git-fork');
  return (
    <div className="px-3 py-1.5 text-[13px] font-medium text-text-primary bg-terminal-surface border border-ink/10 rounded-md shadow-tooltip">
      <div className="w-60 whitespace-normal py-1 flex flex-col gap-3 font-normal">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-text-primary">{count(signal.commits, 'commit')}</span>
            <span className="text-[10px] text-text-tertiary">last 12 months</span>
          </div>
          <Sparkline monthly={signal.monthly} />
        </div>

        <div className="flex flex-col gap-1.5">
          <MeterRow label="Change frequency" rank={signal.freqRank} />
          <MeterRow label="Nesting" rank={signal.cxRank} />
          <div className="text-[10px] text-text-tertiary">{signal.nesting}</div>
        </div>

        <OwnershipBar authors={signal.authors} />

        {signal.partner && (
          <span className="text-[11px] leading-snug text-text-secondary">
            Usually changes with <span className="font-mono text-[10px]">{signal.partner.path}</span> — not in this
            diff
          </span>
        )}

        <div className="pt-2 border-t border-ink/10 flex flex-col gap-1">
          {levers.map((lever) => (
            <span key={lever.text} className="flex gap-1.5 text-[11px] leading-snug text-text-secondary">
              <Icon name={lever.icon} className="w-3 h-3 shrink-0 mt-px text-ink/40" />
              {lever.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-2 pb-2.5 border-b border-ink/[0.08] text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[19px] font-medium text-text-primary">{label}</span>
        <Icon
          name="caret-right"
          className={`w-4 h-4 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-[15px] text-text-tertiary">{count}</span>
      </button>
      {open && <div className="pt-4 flex flex-col">{children}</div>}
    </section>
  );
}

function HotspotEntry({ signal, defaultOpen = false }: { signal: Signal; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const mainAuthor = signal.authors[0].share >= 0.5 ? signal.authors[0].name : '';
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-2 py-1 rounded-md text-left transition-colors duration-100 ${
          open ? 'bg-ink/[0.045]' : 'hover:bg-ink/5'
        }`}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="caret-right"
          className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <Icon name="flame" className={`w-3.5 h-3.5 shrink-0 ${tierGlyph(signal)}`} />
        <span className="flex-1 min-w-0 truncate font-mono text-[12px]">
          <PathName path={signal.path} />
        </span>
        <span className="w-16 shrink-0">
          <Sparkline monthly={signal.monthly} className="h-3.5" />
        </span>
        <TrendMark direction={signal.trend.direction} />
        <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
          {count(signal.commits, 'commit')}
        </span>
        <span className="w-24 shrink-0 truncate text-right text-[10px] text-text-tertiary">{mainAuthor}</span>
      </button>
      {open && <HotspotDetail signal={signal} />}
    </div>
  );
}

function HotspotDetail({ signal }: { signal: Signal }) {
  return (
    <div
      data-hotspot-detail
      className="ml-8 mr-2 mb-2.5 pl-4 pt-3.5 pb-2.5 border-l border-ink/[0.09] flex flex-col gap-4"
    >
      <div className="flex items-start gap-10">
        <div className="flex-1 min-w-0">
          <HistoryChart monthly={signal.monthly} />
          <p className="mt-2.5 text-[11px] text-text-secondary">{describeTrend(signal)}</p>
          <div className="mt-4 flex gap-7">
            <Measure value={signal.loc} label="lines" />
            <Measure value={signal.changed} label="lines changed" />
          </div>
          <div className="mt-5">
            <p className="mb-1.5 text-[11px] text-text-secondary">Ownership</p>
            <OwnershipBar authors={signal.authors} />
          </div>
        </div>

        <div className="w-60 shrink-0 flex flex-col gap-3.5">
          <ScoreMeter
            label="Change frequency"
            rank={signal.freqRank}
            detail={`${count(signal.commits, 'commit')} in 12 months`}
          />
          <ScoreMeter label="Nesting" rank={signal.cxRank} detail={signal.nesting} />
          {signal.partner && (
            <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
              <Icon name="git-fork" className="w-3 h-3 shrink-0 text-ink/30" />
              <span className="min-w-0 truncate">
                Moves with <span className="font-mono text-text-secondary">{basename(signal.partner.path)}</span>{' '}
                {Math.round(signal.partner.degree * 100)}% of the time
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="pt-3.5 border-t border-ink/[0.09] flex items-end justify-between gap-6">
        <ul className="flex flex-col gap-1.5 max-w-[58ch]">
          {signal.levers.map((lever) => (
            <li key={lever.text} className="flex gap-2.5 text-[12.5px] leading-relaxed text-text-primary">
              <Icon name={lever.icon} className="w-3.5 h-3.5 shrink-0 mt-[3px] text-ink/35" />
              <span>{lever.text}</span>
            </li>
          ))}
        </ul>
        <span className="shrink-0 flex items-center gap-1.5 text-[11px] text-text-tertiary">
          Open in editor
          <Icon name="arrow-square-out" className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

function ModuleRow({
  node,
  depth,
  defaultOpen = false,
}: {
  node: (typeof MODULES)[number] | (typeof MODULES)[number]['children'][number];
  depth: number;
  defaultOpen?: boolean;
}) {
  const children = 'children' in node ? node.children : [];
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={children.length > 0 ? open : undefined}
        disabled={children.length === 0}
        className="w-full flex items-center gap-2.5 px-2 py-1 rounded-md text-left enabled:hover:bg-ink/5 transition-colors duration-100"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="caret-right"
          className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform duration-150 ${
            open ? 'rotate-90' : ''
          } ${children.length > 0 ? '' : 'opacity-0'}`}
        />
        <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-ink/90">
          {basename(node.path)}
          <span className="text-ink/35">/</span>
        </span>
        <Track value={node.share} className="w-20 shrink-0 h-1" />
        <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
          {Math.round(node.share * 100)}%
        </span>
        <span
          className={`w-14 shrink-0 text-right font-mono text-[10px] tabular-nums ${
            node.hotspots > 0 ? 'text-git' : 'text-text-tertiary'
          }`}
        >
          {node.hotspots > 0 ? `${node.hotspots} hot` : `${node.files} files`}
        </span>
        <TrendMark direction={node.trend} />
        <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
          {count(node.commits, 'commit')}
        </span>
      </button>
      {open && children.map((child) => <ModuleRow key={child.path} node={child} depth={depth + 1} />)}
    </div>
  );
}

function CouplingRow({
  pair,
  directories = false,
}: {
  pair: { a: string; b: string; degree: number; shared: number };
  directories?: boolean;
}) {
  const suffix = directories ? '/' : '';
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <Icon name={directories ? 'folder-open' : 'git-fork'} className="w-3.5 h-3.5 shrink-0 text-ink/35" />
      <span className="flex-1 min-w-0 truncate font-mono text-[12px]">
        <PathName path={pair.a} suffix={suffix} /> <span className="text-ink/35">↔</span>{' '}
        <PathName path={pair.b} suffix={suffix} />
      </span>
      <Track value={pair.degree} className="w-16 shrink-0 h-1" />
      <span className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
        {Math.round(pair.degree * 100)}% · {count(pair.shared, 'commit')}
      </span>
    </div>
  );
}

function OwnerRow({ name, mainOf, share }: { name: string; mainOf: number; share: number }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <span className="w-44 shrink-0 truncate text-[12px] text-text-secondary">{name}</span>
      <Track value={share} className="flex-1 h-1" />
      <span className="w-36 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
        main author of {count(mainOf, 'file')}
      </span>
    </div>
  );
}

/* ─── Signal atoms, mirroring the app's Signals.tsx ────────────────── */

const tierGlyph = (signal: Signal) => (signal.trend.direction === 'cooling' ? 'text-git/50' : 'text-git');

function Sparkline({ monthly, className = 'mt-1.5 h-6' }: { monthly: number[]; className?: string }) {
  const max = Math.max(...monthly, 1);
  return (
    <div className={`flex items-end gap-[2px] ${className}`} aria-hidden>
      {monthly.map((n, i) => (
        <span
          key={i}
          className={`flex-1 rounded-[1px] ${n > 0 ? 'bg-git/75' : 'bg-ink/15'}`}
          style={{ height: n > 0 ? `${Math.max(10, (n / max) * 100)}%` : '2px' }}
        />
      ))}
    </div>
  );
}

function HistoryChart({ monthly }: { monthly: number[] }) {
  const max = Math.max(...monthly, 1);
  return (
    <div className="w-fit">
      <div className="flex items-end gap-[2px] h-16" aria-hidden>
        {monthly.map((n, i) => (
          <span
            key={i}
            className={`w-6 rounded-t-[4px] ${n === 0 ? 'bg-ink/[0.09]' : i >= RECENT_CUT ? 'bg-git' : 'bg-git/40'}`}
            style={{ height: n > 0 ? `${Math.max(10, (n / max) * 100)}%` : '2px' }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-text-tertiary">
        <span>{MONTH_LABELS[0]}</span>
        <span>{MONTH_LABELS[MONTH_LABELS.length - 1]}</span>
      </div>
    </div>
  );
}

function Track({ value, className }: { value: number; className: string }) {
  return (
    <span className={`rounded-full overflow-hidden bg-ink/10 ${className}`} aria-hidden>
      <span className="block h-full rounded-full bg-git/80" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

function ScoreTrack({ rank, className }: { rank: number; className: string }) {
  return (
    <span className={`block rounded-full overflow-hidden bg-git-light ${className}`} aria-hidden>
      <span className="block h-full rounded-full bg-git" style={{ width: `${Math.round(rank * 100)}%` }} />
    </span>
  );
}

function MeterRow({ label, rank }: { label: string; rank: number }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-[100px] shrink-0 text-text-tertiary">{label}</span>
      <ScoreTrack rank={rank} className="flex-1 h-1" />
      <span className="w-10 shrink-0 text-right tabular-nums text-text-secondary">{topPercent(rank)}</span>
    </div>
  );
}

function ScoreMeter({ label, rank, detail }: { label: string; rank: number; detail: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-text-secondary">{label}</span>
        <span className="tabular-nums text-text-primary">{topPercent(rank)}</span>
      </div>
      <ScoreTrack rank={rank} className="mt-1.5 h-[5px]" />
      <p className="mt-1.5 text-[10px] text-text-tertiary">{detail}</p>
    </div>
  );
}

const OWNER_SEGMENT = ['bg-ink/70', 'bg-ink/40', 'bg-ink/22'];

function OwnershipBar({ authors }: { authors: Array<{ name: string; share: number }> }) {
  const rest = Math.max(0, 1 - authors.reduce((sum, a) => sum + a.share, 0));
  return (
    <div>
      <div className="flex gap-[2px] h-1.5" aria-hidden>
        {authors.map((author, i) => (
          <span key={author.name} className={`rounded-full ${OWNER_SEGMENT[i]}`} style={{ width: `${author.share * 100}%` }} />
        ))}
        {rest > 0.02 && <span className="rounded-full bg-ink/12" style={{ width: `${rest * 100}%` }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
        {authors.map((author, i) => (
          <span key={author.name} className="flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${OWNER_SEGMENT[i]}`} />
            <span className="truncate">{author.name}</span>
            <span className="tabular-nums">{Math.round(author.share * 100)}%</span>
          </span>
        ))}
        {rest > 0.02 && (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-ink/12" />
            others
          </span>
        )}
      </div>
    </div>
  );
}

const TREND_GLYPH = { new: '↑', rising: '↑', steady: '→', cooling: '↓' } as const;
const TREND_WORD = { new: 'All new', rising: 'Rising', steady: 'Steady', cooling: 'Cooling' } as const;

function TrendMark({ direction }: { direction: keyof typeof TREND_GLYPH }) {
  const muted = direction === 'steady' || direction === 'cooling';
  return (
    <span className={`w-4 shrink-0 text-center text-[11px] ${muted ? 'text-text-tertiary' : 'text-git'}`}>
      {TREND_GLYPH[direction]}
    </span>
  );
}

function describeTrend(signal: Signal): string {
  return `${TREND_WORD[signal.trend.direction]} · ${signal.trend.recent} of ${count(
    signal.commits,
    'commit',
  )} in the last 3 months`;
}

function Measure({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-[17px] leading-none tracking-[-0.01em] text-text-primary">{value.toLocaleString()}</div>
      <div className="mt-1.5 text-[10px] text-text-tertiary">{label}</div>
    </div>
  );
}

function PathName({ path, suffix = '' }: { path: string; suffix?: string }) {
  return (
    <>
      <span className="text-ink/35">{dirname(path)}</span>
      <span className="text-ink/90">
        {basename(path)}
        {suffix}
      </span>
    </>
  );
}
