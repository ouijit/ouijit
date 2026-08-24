import { useEffect, type ReactNode } from 'react';
import type { FileSignal } from '../../analysis/types';
import { ANALYSIS_WINDOW_MONTHS } from '../../analysis/types';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Section } from '../github/Sections';
import { RefreshButton } from '../github/RefreshButton';
import { Loading } from '../github/Loading';
import { Sparkline } from '../diff/AnalysisChip';

interface AnalysisPanelProps {
  projectPath: string;
}

/**
 * The project's history read as a whole: where the hotspots are, which files
 * travel together, and who holds the code. Same model the diff chips read.
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
              <Section label="Hotspots" count={overview.hotspots.length} defaultOpen>
                <RowList empty="Nothing runs hot — no file is both frequently changed and complicated.">
                  {overview.hotspots.map(({ path, signal }) => (
                    <HotspotRow key={path} projectPath={projectPath} path={path} signal={signal} />
                  ))}
                </RowList>
              </Section>

              <Section label="Change coupling" count={overview.couplings.length} defaultOpen>
                <RowList empty="No two files change together often enough to couple.">
                  {overview.couplings.map((pair) => (
                    <CouplingRow key={`${pair.a}\u0000${pair.b}`} {...pair} />
                  ))}
                </RowList>
              </Section>

              <Section label="Knowledge" count={overview.owners.length} defaultOpen>
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

function HotspotRow({ projectPath, path, signal }: { projectPath: string; path: string; signal: FileSignal }) {
  const owner = signal.topAuthors[0];
  return (
    <button
      type="button"
      title="Open in editor"
      className="w-full flex items-center gap-2.5 px-2 py-1 rounded-md text-left hover:bg-ink/5 transition-colors duration-100"
      onClick={() => void window.api.openFileInEditor(projectPath, projectPath, path)}
    >
      <Icon name="flame" className={`w-3.5 h-3.5 shrink-0 ${tierColor(signal.tier)}`} />
      <span className="flex-1 min-w-0 truncate font-mono text-[12px]">
        <PathName path={path} />
      </span>
      <span className="w-16 shrink-0">
        <Sparkline monthly={signal.monthly} className="h-3.5" />
      </span>
      <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
        {signal.commits} commits
      </span>
      <span className="w-24 shrink-0 truncate text-right text-[10px] text-text-tertiary">
        {owner && owner.share >= 0.5 ? owner.name : ''}
      </span>
    </button>
  );
}

function CouplingRow({ a, b, shared, degree }: { a: string; b: string; shared: number; degree: number }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <Icon name="git-fork" className="w-3.5 h-3.5 shrink-0 text-ink/35" />
      <span className="flex-1 min-w-0 truncate font-mono text-[12px]" title={`${a} ↔ ${b}`}>
        <PathName path={a} /> <span className="text-ink/35">↔</span> <PathName path={b} />
      </span>
      <Track value={degree} className="w-16 shrink-0" />
      <span className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
        {Math.round(degree * 100)}% · {shared} commits
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

function tierColor(tier: FileSignal['tier']): string {
  return tier === 'hot' ? 'text-git' : tier === 'warm' ? 'text-git/50' : 'text-ink/25';
}

function PathName({ path }: { path: string }) {
  return (
    <>
      <span className="text-ink/35">{dirname(path)}</span>
      <span className="text-ink/90">{basename(path)}</span>
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
