import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { gitAsync, getMainBranchAsync } from '../git';
import { getGlobalSetting } from '../db';
import { experimentalStorageKey, parseExperimentalFlags } from '../experimentalFlags';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import { readLog } from './gitLog';
import {
  ancestorDirs,
  dirOf,
  emptyModel,
  foldCommits,
  monthIndex,
  splitPairKey,
  COUPLING_MIN_SHARED,
  type AnalysisModel,
  type FileStats,
} from './accumulate';
import { complexityOf } from './complexity';
import { scoreFiles, type FileScore } from './score';
import { trendOf } from './trend';
import {
  ANALYSIS_WINDOW_MONTHS,
  type AnalysisOverview,
  type AnalysisStatus,
  type CouplingSignal,
  type DiffSignals,
  type FileComplexitySignal,
  type FileSignal,
  type HotspotRow,
  type ModuleNode,
  type PairSignal,
} from './types';

const analysisLog = getLogger().scope('analysis');

export interface ProjectAnalysis {
  ref: string;
  lastSha: string;
  analyzedAt: number;
  model: AnalysisModel;
  complexity: Map<string, FileComplexitySignal>;
  scores: Map<string, FileScore>;
}

/**
 * The whole result is a derivation of git history, so nothing is persisted:
 * one entry per project, rebuilt in under a second on the first request after
 * a restart. See docs/plans/behavioural-analysis.md.
 */
const cache = new Map<string, ProjectAnalysis>();
const inflight = new Map<string, Promise<ProjectAnalysis | null>>();
const attemptedAt = new Map<string, number>();

/** Refreshes are driven by a 30s renderer poll; the floor must stay under it. */
const REFRESH_MIN_INTERVAL_MS = 25_000;
/** Complexity is read from the working tree for the most-changed files only. */
const COMPLEXITY_FILE_LIMIT = 200;
const COMPLEXITY_READ_BATCH = 16;
const COMPLEXITY_MAX_BYTES = 2 * 1024 * 1024;

async function isAnalysisEnabled(projectPath: string): Promise<boolean> {
  const raw = await getGlobalSetting(experimentalStorageKey(projectPath));
  return parseExperimentalFlags(raw).analysis;
}

/**
 * Cheap-gated refresh: a `rev-parse` decides whether anything moved, and the
 * log pass only runs when it did. Rate-limited and deduped so the poll can
 * call it blindly.
 */
export async function refreshAnalysis(projectPath: string): Promise<AnalysisStatus | null> {
  if (!(await isAnalysisEnabled(projectPath))) return null;

  const pending = inflight.get(projectPath);
  if (pending) return pending.then((analysis) => (analysis ? toStatus(analysis) : null));

  const last = attemptedAt.get(projectPath);
  if (last != null && Date.now() - last < REFRESH_MIN_INTERVAL_MS) {
    const analysis = cache.get(projectPath);
    return analysis ? toStatus(analysis) : null;
  }
  attemptedAt.set(projectPath, Date.now());

  const analysis = await scanProject(projectPath);
  return analysis ? toStatus(analysis) : null;
}

/** Signals for one file list — what the diff and PR surfaces render from. */
export async function getDiffSignals(projectPath: string, paths: string[]): Promise<DiffSignals | null> {
  if (!(await isAnalysisEnabled(projectPath))) return null;
  const analysis = cache.get(projectPath) ?? (await scanProject(projectPath));
  if (!analysis) return null;

  const thisMonth = monthIndex(Date.now() / 1000);
  const files: Record<string, FileSignal> = {};
  for (const p of paths) {
    const signal = toFileSignal(analysis, p, thisMonth);
    if (signal) files[p] = signal;
  }

  const asked = new Set(paths);
  const couplings: CouplingSignal[] = [];
  for (const [key, shared] of analysis.model.couplings) {
    if (shared < COUPLING_MIN_SHARED) continue;
    const [a, b] = splitPairKey(key);
    const inA = asked.has(a);
    const inB = asked.has(b);
    if (!inA && !inB) continue;
    const degree = pairDegree(analysis.model.files, a, b, shared);
    if (inA) couplings.push({ path: a, partner: b, shared, degree });
    if (inB) couplings.push({ path: b, partner: a, shared, degree });
  }

  return { files, couplings };
}

const OVERVIEW_ROWS = 30;
const OVERVIEW_OWNERS = 8;
const MODULE_MAX_DEPTH = 4;
const MODULE_MAX_CHILDREN = 12;

/** The project-level view — hotspots, modules, coupling, ownership. */
export async function getAnalysisOverview(projectPath: string): Promise<AnalysisOverview | null> {
  if (!(await isAnalysisEnabled(projectPath))) return null;
  const analysis = cache.get(projectPath) ?? (await scanProject(projectPath));
  if (!analysis) return null;
  const thisMonth = monthIndex(Date.now() / 1000);

  const couplings = rankPairs(analysis.model.couplings, analysis.model.files);
  const strongest = strongestPartners(couplings);

  const hotspots: HotspotRow[] = [...analysis.scores.entries()]
    .filter(([, score]) => score.score > 0)
    .sort((x, y) => y[1].score - x[1].score)
    .slice(0, OVERVIEW_ROWS)
    .flatMap(([p]) => {
      const signal = toFileSignal(analysis, p, thisMonth);
      return signal ? [{ path: p, signal, partner: strongest.get(p) ?? null }] : [];
    });

  const byEmail = new Map<string, { name: string; mainOf: number }>();
  for (const authors of analysis.model.authors.values()) {
    let topEmail: string | null = null;
    let topName = '';
    let top = 0;
    for (const [email, author] of authors) {
      if (author.commits > top) {
        top = author.commits;
        topEmail = email;
        topName = author.name;
      }
    }
    if (topEmail == null) continue;
    const entry = byEmail.get(topEmail);
    if (entry) entry.mainOf++;
    else byEmail.set(topEmail, { name: topName, mainOf: 1 });
  }
  const owners = [...byEmail.values()].sort((x, y) => y.mainOf - x.mainOf).slice(0, OVERVIEW_OWNERS);

  const monthly = toMonthly(analysis.model.commitsByMonth, thisMonth);

  return {
    status: toStatus(analysis),
    fileCount: analysis.model.files.size,
    monthly,
    trend: trendOf(monthly),
    hotspots,
    modules: buildModules(analysis, thisMonth),
    moduleCouplings: rankPairs(analysis.model.dirCouplings, analysis.model.dirs).slice(0, OVERVIEW_ROWS),
    couplings: couplings.slice(0, OVERVIEW_ROWS),
    owners,
  };
}

function pairDegree(stats: ReadonlyMap<string, FileStats>, a: string, b: string, shared: number): number {
  return shared / Math.max(stats.get(a)?.commits ?? shared, stats.get(b)?.commits ?? shared);
}

/**
 * Strongest first. Degree alone puts three commits that happened to coincide
 * above a pair that has moved together seventy times, so the sort shrinks it
 * towards zero by how much evidence there is; the reported degree is the real
 * one.
 */
const COUPLING_EVIDENCE_HALF = 5;

function rankPairs(pairs: ReadonlyMap<string, number>, stats: ReadonlyMap<string, FileStats>): PairSignal[] {
  const ranked: PairSignal[] = [];
  for (const [key, shared] of pairs) {
    if (shared < COUPLING_MIN_SHARED) continue;
    const [a, b] = splitPairKey(key);
    ranked.push({ a, b, shared, degree: pairDegree(stats, a, b, shared) });
  }
  const weight = (pair: PairSignal) => (pair.degree * pair.shared) / (pair.shared + COUPLING_EVIDENCE_HALF);
  ranked.sort((x, y) => weight(y) - weight(x));
  return ranked;
}

/** Takes rankPairs' order, so a thin coincidence cannot outrank a real pair. */
function strongestPartners(ranked: readonly PairSignal[]): Map<string, { path: string; degree: number }> {
  const best = new Map<string, { path: string; degree: number }>();
  for (const pair of ranked) {
    if (!best.has(pair.a)) best.set(pair.a, { path: pair.b, degree: pair.degree });
    if (!best.has(pair.b)) best.set(pair.b, { path: pair.a, degree: pair.degree });
  }
  return best;
}

/**
 * The directory tree, each node holding everything beneath it. Depth and
 * breadth are capped: past those a monorepo turns this into a file browser,
 * and the point of the section is the shape of the project.
 */
function buildModules(analysis: ProjectAnalysis, thisMonth: number): ModuleNode[] {
  const filesUnder = new Map<string, number>();
  const hotUnder = new Map<string, number>();
  for (const [p, score] of analysis.scores) {
    for (const dir of ancestorDirs(p)) {
      filesUnder.set(dir, (filesUnder.get(dir) ?? 0) + 1);
      if (score.tier === 'hot') hotUnder.set(dir, (hotUnder.get(dir) ?? 0) + 1);
    }
  }

  const total = analysis.model.commitCount;
  const nodes = new Map<string, ModuleNode>();
  for (const [dir, stats] of analysis.model.dirs) {
    if (depthOf(dir) > MODULE_MAX_DEPTH) continue;
    const monthly = toMonthly(stats.byMonth, thisMonth);
    nodes.set(dir, {
      path: dir,
      commits: stats.commits,
      // Replaced with the share of its parent once the tree is linked.
      share: total > 0 ? stats.commits / total : 0,
      added: stats.added,
      deleted: stats.deleted,
      files: filesUnder.get(dir) ?? 0,
      hotspots: hotUnder.get(dir) ?? 0,
      monthly,
      trend: trendOf(monthly),
      children: [],
    });
  }

  const roots: ModuleNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(dirOf(node.path));
    if (parent) {
      parent.children.push(node);
      // Against the parent rather than the project: three levels down, every
      // share of the whole rounds to nothing and the bars stop saying anything.
      node.share = parent.commits > 0 ? node.commits / parent.commits : 0;
    } else {
      roots.push(node);
    }
  }

  const rank = (list: ModuleNode[]) => {
    list.sort((a, b) => b.hotspots - a.hotspots || b.commits - a.commits);
    list.length = Math.min(list.length, MODULE_MAX_CHILDREN);
    for (const node of list) rank(node.children);
  };
  rank(roots);
  return roots;
}

function depthOf(dir: string): number {
  let depth = 1;
  for (let i = dir.indexOf('/'); i !== -1; i = dir.indexOf('/', i + 1)) depth++;
  return depth;
}

/** A month map spread over the window, oldest month first. */
function toMonthly(byMonth: ReadonlyMap<number, number>, thisMonth: number): number[] {
  const monthly = new Array<number>(ANALYSIS_WINDOW_MONTHS).fill(0);
  for (const [month, n] of byMonth) {
    const i = ANALYSIS_WINDOW_MONTHS - 1 - (thisMonth - month);
    if (i >= 0 && i < ANALYSIS_WINDOW_MONTHS) monthly[i] += n;
  }
  return monthly;
}

function toFileSignal(analysis: ProjectAnalysis, p: string, thisMonth: number): FileSignal | null {
  const stats = analysis.model.files.get(p);
  if (!stats) return null;

  const byEmail = analysis.model.authors.get(p);
  const topAuthors = byEmail
    ? [...byEmail.values()]
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 3)
        .map((a) => ({ name: a.name, share: stats.commits > 0 ? a.commits / stats.commits : 0 }))
    : [];

  const monthly = toMonthly(stats.byMonth, thisMonth);
  const score = analysis.scores.get(p);
  return {
    commits: stats.commits,
    added: stats.added,
    deleted: stats.deleted,
    firstAt: stats.firstAt,
    lastAt: stats.lastAt,
    score: score?.score ?? 0,
    tier: score?.tier ?? 'quiet',
    freqRank: score?.freqRank ?? 0,
    cxRank: score?.cxRank ?? null,
    monthly,
    trend: trendOf(monthly),
    topAuthors,
    authorCount: byEmail?.size ?? 0,
    complexity: analysis.complexity.get(p) ?? null,
  };
}

/**
 * Ensures the project's analysis is current, deduping concurrent callers.
 * Exported for the integration tests; everything user-facing goes through the
 * flag-gated reads above.
 */
export function scanProject(projectPath: string): Promise<ProjectAnalysis | null> {
  const pending = inflight.get(projectPath);
  if (pending) return pending;

  const run = scan(projectPath)
    .catch((error) => {
      analysisLog.warn('scan failed', { projectPath, error: describeError(error) });
      return cache.get(projectPath) ?? null;
    })
    .finally(() => inflight.delete(projectPath));
  inflight.set(projectPath, run);
  return run;
}

export function invalidateAnalysis(projectPath?: string): void {
  if (projectPath == null) {
    cache.clear();
    attemptedAt.clear();
  } else {
    cache.delete(projectPath);
    attemptedAt.delete(projectPath);
  }
}

async function scan(projectPath: string): Promise<ProjectAnalysis | null> {
  const ref = await getMainBranchAsync(projectPath);
  const sha = await gitAsync(['rev-parse', '--verify', `${ref}^{commit}`], projectPath).catch((): null => null);
  if (!sha) return null;

  const prev = cache.get(projectPath);
  if (prev && prev.lastSha === sha) return prev;

  let analysis: ProjectAnalysis;
  if (prev && (await isAncestor(projectPath, prev.lastSha, sha))) {
    // Oldest first: renames migrate a path's history forward in time.
    foldCommits(prev.model, (await readLog(projectPath, `${prev.lastSha}..${sha}`)).reverse());
    analysis = prev;
  } else {
    // First scan, or history was rewritten under the old tip.
    const model = emptyModel();
    foldCommits(model, (await readLog(projectPath, sha)).reverse());
    analysis = { ref, lastSha: sha, analyzedAt: 0, model, complexity: new Map(), scores: new Map() };
  }

  analysis.ref = ref;
  analysis.lastSha = sha;
  analysis.analyzedAt = Date.now();
  analysis.complexity = await readComplexity(projectPath, analysis.model);
  analysis.scores = scoreFiles(analysis.model, analysis.complexity);
  cache.set(projectPath, analysis);
  return analysis;
}

function isAncestor(projectPath: string, ancestor: string, descendant: string): Promise<boolean> {
  return gitAsync(['merge-base', '--is-ancestor', ancestor, descendant], projectPath).then(
    () => true,
    () => false,
  );
}

/**
 * Machine-written files change constantly and nest deeply, so they top every
 * hotspot list without telling a reviewer anything. Left out of complexity —
 * which keeps them quiet — but not out of coupling: "usually changes with
 * package-lock.json" is a real reminder.
 */
const MACHINE_WRITTEN = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'composer.lock',
  'go.sum',
]);

async function readComplexity(projectPath: string, model: AnalysisModel): Promise<Map<string, FileComplexitySignal>> {
  const candidates = [...model.files.entries()]
    .filter(([p]) => !MACHINE_WRITTEN.has(p.slice(p.lastIndexOf('/') + 1)))
    .sort((a, b) => b[1].commits - a[1].commits)
    .slice(0, COMPLEXITY_FILE_LIMIT)
    .map(([p]) => p);

  const out = new Map<string, FileComplexitySignal>();
  for (let i = 0; i < candidates.length; i += COMPLEXITY_READ_BATCH) {
    await Promise.all(
      candidates.slice(i, i + COMPLEXITY_READ_BATCH).map(async (rel) => {
        try {
          const text = await readFile(path.join(projectPath, rel), 'utf8');
          if (text.length <= COMPLEXITY_MAX_BYTES) out.set(rel, complexityOf(text));
        } catch {
          // Deleted since, or unreadable: no complexity, so it stays quiet.
        }
      }),
    );
  }
  return out;
}

function toStatus(analysis: ProjectAnalysis): AnalysisStatus {
  return {
    ref: analysis.ref,
    lastSha: analysis.lastSha,
    analyzedAt: analysis.analyzedAt,
    commitCount: analysis.model.commitCount,
  };
}
