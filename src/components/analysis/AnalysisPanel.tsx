import { useEffect, useState, type ReactNode } from 'react';
import type { HotspotRow, ModuleNode, PairSignal, Trend } from '../../analysis/types';
import { ANALYSIS_WINDOW_MONTHS, TREND_RECENT_MONTHS } from '../../analysis/types';
import { evidenceFor, leversFor } from '../../analysis/advice';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Section } from '../github/Sections';
import { RefreshButton } from '../github/RefreshButton';
import { Loading } from '../github/Loading';
import { MeterRow, OwnershipBar, Sparkline } from '../diff/AnalysisChip';

interface AnalysisPanelProps {
  projectPath: string;
}

/**
 * The project's history read as a whole: where the hotspots are, what each
 * one is made of, how the modules are shaped, which files travel together,
 * and who holds the code. Same model the diff chips read.
 */
export function AnalysisPanel({ projectPath }: AnalysisPanelProps) {
  const overview = useAnalysisStore((s) => s.overview);
  const loading = useAnalysisStore((s) => s.overviewLoading);
  const error = useAnalysisStore((s) => s.overviewError);

  useEffect(() => {
    void useAnalysisStore.getState().loadOverview(projectPath);
  }, [projectPath]);

  // Escape leaves the panel, as the settings and GitHub panels do.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      useProjectStore.getState().setActivePanel('terminals');
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <Frame>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-2 px-4">
          <Icon name="flame" className="w-4 h-4 text-git/80" />
          <span className="text-[13px] font-medium text-text-primary">Behavioural analysis</span>
          <span className="ml-auto text-[11px] text-text-tertiary truncate">
            {overview &&
              `${overview.status.commitCount} commits · ${overview.fileCount} files · last ${ANALYSIS_WINDOW_MONTHS} months`}
          </span>
          <RefreshButton
            busy={loading}
            onClick={() => void useAnalysisStore.getState().loadOverview(projectPath, { refresh: true })}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {!overview && loading && <Loading label="Reading history" />}
          {!overview && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 py-16">
              <p className="text-[15px] text-text-secondary max-w-sm text-center">
                {error ?? 'No history to analyse yet.'}
              </p>
            </div>
          )}
          {overview && (
            <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-7">
              <div className="flex items-center gap-3">
                <span className="w-40 shrink-0">
                  <Sparkline monthly={overview.monthly} className="h-6" />
                </span>
                <span className="text-[12px] text-text-secondary">{describeTrend(overview.trend, 'commits')}</span>
              </div>

              <Section label="Hotspots" count={overview.hotspots.length} defaultOpen>
                <RowList empty="Nothing runs hot — no file is both frequently changed and complicated.">
                  {overview.hotspots.map((row) => (
                    <HotspotEntry key={row.path} projectPath={projectPath} row={row} />
                  ))}
                </RowList>
              </Section>

              <Section label="Modules" count={overview.modules.length} defaultOpen>
                <RowList empty="Every file sits at the repository root.">
                  {overview.modules.map((node, i) => (
                    <ModuleRow key={node.path} node={node} depth={0} defaultOpen={i === 0} />
                  ))}
                </RowList>
              </Section>

              <Section label="Coupled modules" count={overview.moduleCouplings.length}>
                <RowList empty="No two directories change together often enough to couple.">
                  {overview.moduleCouplings.map((pair) => (
                    <CouplingRow key={pairId(pair)} pair={pair} directories />
                  ))}
                </RowList>
              </Section>

              <Section label="Coupled files" count={overview.couplings.length}>
                <RowList empty="No two files change together often enough to couple.">
                  {overview.couplings.map((pair) => (
                    <CouplingRow key={pairId(pair)} pair={pair} />
                  ))}
                </RowList>
              </Section>

              <Section label="Knowledge" count={overview.owners.length}>
                <RowList empty="No commits in the window.">
                  {overview.owners.map((owner) => (
                    <OwnerRow key={owner.name} {...owner} fileCount={overview.fileCount} />
                  ))}
                </RowList>
              </Section>
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
}

/** A hotspot, and on demand the numbers and the moves they argue for. */
function HotspotEntry({ projectPath, row }: { projectPath: string; row: HotspotRow }) {
  const [open, setOpen] = useState(false);
  const { path, signal } = row;
  const owner = signal.topAuthors[0];

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-2 py-1 rounded-md text-left hover:bg-ink/5 transition-colors duration-100"
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="caret-right"
          className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <Icon name="flame" className={`w-3.5 h-3.5 shrink-0 ${tierColor(signal.tier)}`} />
        <span className="flex-1 min-w-0 truncate font-mono text-[12px]">
          <PathName path={path} />
        </span>
        <span className="w-16 shrink-0">
          <Sparkline monthly={signal.monthly} className="h-3.5" />
        </span>
        <TrendMark trend={signal.trend} />
        <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
          {signal.commits} commits
        </span>
        <span className="w-24 shrink-0 truncate text-right text-[10px] text-text-tertiary">
          {owner && owner.share >= 0.5 ? owner.name : ''}
        </span>
      </button>

      {open && <HotspotDetail projectPath={projectPath} row={row} />}
    </div>
  );
}

function HotspotDetail({ projectPath, row }: { projectPath: string; row: HotspotRow }) {
  const { signal } = row;
  const levers = leversFor(signal, row.partner);

  return (
    <div className="ml-8 mr-2 mb-2 pl-3 border-l border-ink/10 flex flex-col gap-2.5 py-2">
      <div className="w-72 flex flex-col gap-1.5">
        <MeterRow label="Change frequency" rank={signal.freqRank} />
        {signal.cxRank != null && <MeterRow label="Nesting" rank={signal.cxRank} />}
      </div>

      <div className="flex flex-col gap-0.5">
        {evidenceFor(signal).map((line) => (
          <span key={line} className="text-[11px] text-text-tertiary">
            {line}
          </span>
        ))}
        {row.partner && (
          <span className="text-[11px] text-text-tertiary">
            moves with <span className="font-mono text-[10px]">{row.partner.path}</span>{' '}
            {Math.round(row.partner.degree * 100)}% of the time
          </span>
        )}
      </div>

      {signal.topAuthors.length > 0 && (
        <div className="w-72">
          <OwnershipBar topAuthors={signal.topAuthors} />
        </div>
      )}

      {levers.length > 0 && (
        <div className="pt-2 border-t border-ink/10 flex flex-col gap-0.5">
          {levers.map((lever) => (
            <span key={lever.id} className="text-[12px] text-text-secondary">
              {lever.text}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        className="self-start text-[11px] text-text-tertiary hover:text-accent transition-colors duration-100"
        onClick={() => void window.api.openFileInEditor(projectPath, projectPath, row.path)}
      >
        Open in editor
      </button>
    </div>
  );
}

function ModuleRow({ node, depth, defaultOpen = false }: { node: ModuleNode; depth: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = node.children.length > 0;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="w-full flex items-center gap-2.5 px-2 py-1 rounded-md text-left enabled:hover:bg-ink/5 transition-colors duration-100"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="caret-right"
          className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform duration-150 ${
            open ? 'rotate-90' : ''
          } ${expandable ? '' : 'opacity-0'}`}
        />
        <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-ink/90">
          {basename(node.path)}
          <span className="text-ink/35">/</span>
        </span>
        <Track value={node.share} className="w-20 shrink-0" />
        <span
          className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary"
          title={depth === 0 ? 'of the project' : 'of the directory above'}
        >
          {Math.round(node.share * 100)}%
        </span>
        <span className={`w-14 shrink-0 text-right font-mono text-[10px] tabular-nums ${node.hotspots > 0 ? 'text-git' : 'text-text-tertiary'}`}>
          {node.hotspots > 0 ? `${node.hotspots} hot` : `${node.files} files`}
        </span>
        <TrendMark trend={node.trend} />
        <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
          {node.commits} commits
        </span>
      </button>

      {open && node.children.map((child) => <ModuleRow key={child.path} node={child} depth={depth + 1} />)}
    </div>
  );
}

function CouplingRow({ pair, directories = false }: { pair: PairSignal; directories?: boolean }) {
  const suffix = directories ? '/' : '';
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <Icon name={directories ? 'folder-open' : 'git-fork'} className="w-3.5 h-3.5 shrink-0 text-ink/35" />
      <span className="flex-1 min-w-0 truncate font-mono text-[12px]" title={`${pair.a} ↔ ${pair.b}`}>
        <PathName path={pair.a} suffix={suffix} /> <span className="text-ink/35">↔</span>{' '}
        <PathName path={pair.b} suffix={suffix} />
      </span>
      <Track value={pair.degree} className="w-16 shrink-0" />
      <span className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
        {Math.round(pair.degree * 100)}% · {pair.shared} commits
      </span>
    </div>
  );
}

function OwnerRow({ name, mainOf, fileCount }: { name: string; mainOf: number; fileCount: number }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <span className="w-44 shrink-0 truncate text-[12px] text-text-secondary">{name}</span>
      <Track value={fileCount > 0 ? mainOf / fileCount : 0} className="flex-1" />
      <span className="w-36 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
        main author of {mainOf} {mainOf === 1 ? 'file' : 'files'}
      </span>
    </div>
  );
}

const TREND_GLYPH: Record<Trend['direction'], string> = {
  new: '↑',
  rising: '↑',
  steady: '→',
  cooling: '↓',
};

function TrendMark({ trend }: { trend: Trend }) {
  const muted = trend.direction === 'steady' || trend.direction === 'cooling';
  return (
    <span
      className={`w-4 shrink-0 text-center text-[11px] ${muted ? 'text-text-tertiary' : 'text-git'}`}
      title={describeTrend(trend, 'commits')}
    >
      {TREND_GLYPH[trend.direction]}
    </span>
  );
}

function describeTrend(trend: Trend, unit: string): string {
  const share = `${trend.recent} of ${trend.total} ${unit} in the last ${TREND_RECENT_MONTHS} months`;
  const word =
    trend.direction === 'new'
      ? 'All new'
      : trend.direction === 'rising'
        ? 'Rising'
        : trend.direction === 'cooling'
          ? 'Cooling'
          : 'Steady';
  return `${word} · ${share}`;
}

function Track({ value, className }: { value: number; className: string }) {
  return (
    <span className={`h-1 rounded-full bg-ink/10 overflow-hidden ${className}`} aria-hidden>
      <span className="block h-full rounded-full bg-git/80" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

function RowList({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (children.length === 0) {
    return <p className="px-2 py-2 font-mono text-[11px] text-text-tertiary">{empty}</p>;
  }
  return <div className="flex flex-col">{children}</div>;
}

function tierColor(tier: HotspotRow['signal']['tier']): string {
  return tier === 'hot' ? 'text-git' : tier === 'warm' ? 'text-git/50' : 'text-ink/25';
}

function pairId(pair: PairSignal): string {
  return `${pair.a}\u0000${pair.b}`;
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

function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut + 1);
}

function basename(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Same floating panel frame the GitHub surface uses. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="glass-bevel fixed top-[82px] bottom-4 z-[140] flex rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        right: 16,
        transition: 'left 0.2s ease-out',
        background: 'var(--color-terminal-bg)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      {children}
    </div>
  );
}
