import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { gitAsync, getMainBranchAsync } from '../git';
import { getGlobalSetting } from '../db';
import { experimentalStorageKey, parseExperimentalFlags } from '../experimentalFlags';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import { readLog } from './gitLog';
import {
  emptyModel,
  foldCommits,
  splitPairKey,
  COUPLING_MIN_SHARED,
  type AnalysisModel,
  type FileStats,
} from './accumulate';
import { ancestorDirs, basename, depthOf, dirOf } from './paths';
import { complexityOf } from './complexity';
import { scoreFiles, type FileScore } from './score';
import { trendOf } from './trend';
import {
  ANALYSIS_WINDOW_MONTHS,
  COUPLING_MIN_DEGREE,
  monthIndex,
  type AnalysisOverview,
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
  lastSha: string;
  model: AnalysisModel;
  complexity: Map<string, FileComplexitySignal>;
  scores: Map<string, FileScore>;
  /** Derived on first read and held until the next scan replaces it. */
  overview?: AnalysisOverview;
}

/**
 * The whole result is a derivation of git history, so nothing is persisted:
 * one entry per project, rebuilt in under a second on the first request after
 * a restart. See docs/plans/behavioural-analysis.md.
 */
const cache = new Map<string, ProjectAnalysis>();
const inflight = new Map<string, Promise<ProjectAnalysis | null>>();
const attemptedAt = new Map<string, number>();

/** How stale the model is allowed to get, however often a poll asks. */
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
export async function refreshAnalysis(projectPath: string): Promise<void> {
  if (!(await isAnalysisEnabled(projectPath))) return;
  if (inflight.has(projectPath)) return;

  const last = attemptedAt.get(projectPath);
  if (last != null && Date.now() - last < REFRESH_MIN_INTERVAL_MS) return;
  attemptedAt.set(projectPath, Date.now());

  await scanProject(projectPath);
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

  const couplings: CouplingSignal[] = [];
  for (const p of paths) {
    for (const key of analysis.model.pairsByPath.get(p) ?? []) {
      const shared = analysis.model.couplings.get(key) ?? 0;
      if (shared < COUPLING_MIN_SHARED) continue;
      const [a, b] = splitPairKey(key);
      const degree = pairDegree(analysis.model.files, a, b, shared);
      if (degree < COUPLING_MIN_DEGREE) continue;
      couplings.push({ path: p, partner: a === p ? b : a, shared, degree });
    }
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
  if (analysis.overview) return analysis.overview;

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

  analysis.overview = {
    commitCount: analysis.model.commitCount,
    fileCount: analysis.model.files.size,
    monthly,
    trend: trendOf(monthly),
    hotspots,
    modules: buildModules(analysis, thisMonth),
    moduleCouplings: rankPairs(analysis.model.dirCouplings, analysis.model.dirs).slice(0, OVERVIEW_ROWS),
    couplings: couplings.slice(0, OVERVIEW_ROWS),
    owners,
  };
  return analysis.overview;
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
    if (pair.degree < COUPLING_MIN_DEGREE) continue;
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
  const score = analysis.scores.get(p);
  if (!stats || !score) return null;

  const byEmail = analysis.model.authors.get(p);
  const topAuthors = byEmail
    ? [...byEmail.values()]
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 3)
        .map((a) => ({ name: a.name, share: stats.commits > 0 ? a.commits / stats.commits : 0 }))
    : [];

  const monthly = toMonthly(stats.byMonth, thisMonth);
  return {
    commits: stats.commits,
    added: stats.added,
    deleted: stats.deleted,
    firstAt: stats.firstAt,
    lastAt: stats.lastAt,
    score: score.score,
    tier: score.tier,
    freqRank: score.freqRank,
    cxRank: score.cxRank,
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
  let touched: ReadonlySet<string> | undefined;
  if (prev && (await isAncestor(projectPath, prev.lastSha, sha))) {
    const commits = (await readLog(projectPath, `${prev.lastSha}..${sha}`)).reverse();
    touched = new Set(commits.flatMap((c) => c.files.map((f) => f.path)));
    // Oldest first: renames migrate a path's history forward in time.
    foldCommits(prev.model, commits);
    analysis = prev;
  } else {
    // First scan, or history was rewritten under the old tip.
    const model = emptyModel();
    foldCommits(model, (await readLog(projectPath, sha)).reverse());
    analysis = { lastSha: sha, model, complexity: new Map(), scores: new Map() };
  }

  analysis.lastSha = sha;
  analysis.complexity = await readComplexity(projectPath, analysis.model, analysis.complexity, touched);
  analysis.scores = scoreFiles(analysis.model, analysis.complexity);
  analysis.overview = undefined;
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

/**
 * Reads the most-changed files from the working tree. `touched` names the
 * paths the fold just moved; anything else still holds whatever the last scan
 * read for it. Undefined means read everything, for a scan with nothing
 * behind it. The candidate list is rebuilt either way — the ranking shifts
 * even where the files do not.
 */
async function readComplexity(
  projectPath: string,
  model: AnalysisModel,
  known: ReadonlyMap<string, FileComplexitySignal>,
  touched: ReadonlySet<string> | undefined,
): Promise<Map<string, FileComplexitySignal>> {
  const out = new Map<string, FileComplexitySignal>();
  const toRead: string[] = [];
  for (const p of rankedCandidates(model)) {
    const unchanged = touched != null && !touched.has(p);
    const cached = unchanged ? known.get(p) : undefined;
    if (cached) out.set(p, cached);
    else toRead.push(p);
  }

  for (let i = 0; i < toRead.length; i += COMPLEXITY_READ_BATCH) {
    await Promise.all(
      toRead.slice(i, i + COMPLEXITY_READ_BATCH).map(async (rel) => {
        const full = path.join(projectPath, rel);
        try {
          if ((await stat(full)).size > COMPLEXITY_MAX_BYTES) return;
          out.set(rel, complexityOf(await readFile(full, 'utf8')));
        } catch {
          // Deleted since, or unreadable: no complexity, so it stays quiet.
        }
      }),
    );
  }
  return out;
}

function rankedCandidates(model: AnalysisModel): string[] {
  return [...model.files.entries()]
    .filter(([p]) => !MACHINE_WRITTEN.has(basename(p)))
    .sort((a, b) => b[1].commits - a[1].commits)
    .slice(0, COMPLEXITY_FILE_LIMIT)
    .map(([p]) => p);
}

