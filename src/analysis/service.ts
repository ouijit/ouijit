import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { gitAsync, getMainBranchAsync } from '../git';
import { getGlobalSetting } from '../db';
import { experimentalStorageKey, parseExperimentalFlags } from '../experimentalFlags';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import { readLog } from './gitLog';
import { emptyModel, foldCommits, splitPairKey, type Activity, type AnalysisModel } from './accumulate';
import { ancestorDirs, basename, depthOf, dirOf } from './paths';
import { complexityOf } from './complexity';
import { scoreFiles } from './score';
import { trendOf } from './trend';
import {
  ANALYSIS_WINDOW_MONTHS,
  COUPLING_MIN_DEGREE,
  COUPLING_MIN_SHARED,
  monthIndex,
  type AnalysisOverview,
  type DiffSignals,
  type FileComplexitySignal,
  type FileScore,
  type FileSignal,
  type HotspotRow,
  type ModuleNode,
  type Owner,
  type PairSignal,
  type Partner,
} from './types';

const analysisLog = getLogger().scope('analysis');

export interface ProjectAnalysis {
  lastSha: string;
  /** The month it was built in — see scan, which starts over on a new one. */
  builtInMonth: number;
  model: AnalysisModel;
  complexity: Map<string, FileComplexitySignal>;
  scores: Map<string, FileScore>;
  /** Derived on first read and held until the next scan replaces it. */
  overview?: AnalysisOverview;
}

/** The whole result is a derivation of git history, so nothing is persisted. */
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
export async function refreshAnalysis(projectPath: string, force = false): Promise<void> {
  if (!(await isAnalysisEnabled(projectPath))) return;

  const pending = inflight.get(projectPath);
  if (pending) {
    // Someone asking outright waits for the answer; the poll does not care.
    if (force) await pending;
    return;
  }

  const last = attemptedAt.get(projectPath);
  if (!force && last != null && Date.now() - last < REFRESH_MIN_INTERVAL_MS) return;
  attemptedAt.set(projectPath, Date.now());

  await scanProject(projectPath);
}

async function readAnalysis(projectPath: string): Promise<ProjectAnalysis | null> {
  if (!(await isAnalysisEnabled(projectPath))) return null;
  return cache.get(projectPath) ?? (await scanProject(projectPath));
}

export async function getDiffSignals(projectPath: string, paths: string[]): Promise<DiffSignals | null> {
  const analysis = await readAnalysis(projectPath);
  if (!analysis) return null;

  const thisMonth = monthIndex(Date.now() / 1000);
  const asked = new Set(paths);
  const signals: DiffSignals = {};
  for (const p of paths) {
    const signal = toFileSignal(analysis, p, thisMonth);
    if (signal) signals[p] = { signal, missing: missingPartners(analysis.model, p, asked) };
  }
  return signals;
}

const MISSING_PARTNER_LIMIT = 3;

/** Files `p` usually changes with that the diff leaves out. */
function missingPartners(model: AnalysisModel, p: string, asked: ReadonlySet<string>): string[] {
  const ranked: Array<{ partner: string; degree: number }> = [];
  for (const key of model.pairsByPath.get(p) ?? []) {
    const shared = model.couplings.get(key) ?? 0;
    if (shared < COUPLING_MIN_SHARED) continue;
    const [a, b] = splitPairKey(key);
    const partner = a === p ? b : a;
    if (asked.has(partner)) continue;
    const degree = pairDegree(model.files, a, b, shared);
    if (degree < COUPLING_MIN_DEGREE) continue;
    ranked.push({ partner, degree });
  }
  return ranked
    .sort((x, y) => y.degree - x.degree)
    .slice(0, MISSING_PARTNER_LIMIT)
    .map((r) => r.partner);
}

const OVERVIEW_ROWS = 30;
const OVERVIEW_OWNERS = 8;
const MODULE_MAX_DEPTH = 4;
const MODULE_MAX_CHILDREN = 12;

export async function getAnalysisOverview(projectPath: string): Promise<AnalysisOverview | null> {
  const analysis = await readAnalysis(projectPath);
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
  const fileCount = analysis.model.files.size;
  const owners: Owner[] = [...byEmail.values()]
    .sort((x, y) => y.mainOf - x.mainOf)
    .slice(0, OVERVIEW_OWNERS)
    .map((owner) => ({ ...owner, share: fileCount > 0 ? owner.mainOf / fileCount : 0 }));

  const monthly = toMonthly(analysis.model.commitsByMonth, thisMonth);

  analysis.overview = {
    commitCount: analysis.model.commitCount,
    fileCount,
    endMonth: thisMonth,
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

function pairDegree(stats: ReadonlyMap<string, Activity>, a: string, b: string, shared: number): number {
  return shared / Math.max(stats.get(a)?.commits ?? shared, stats.get(b)?.commits ?? shared);
}

/**
 * Strongest first. Degree alone puts three commits that happened to coincide
 * above a pair that has moved together seventy times, so the sort shrinks it
 * towards zero by how much evidence there is; the reported degree is the real
 * one.
 */
const COUPLING_EVIDENCE_HALF = 5;

function rankPairs(pairs: ReadonlyMap<string, number>, stats: ReadonlyMap<string, Activity>): PairSignal[] {
  const weighted: Array<{ pair: PairSignal; weight: number }> = [];
  for (const [key, shared] of pairs) {
    if (shared < COUPLING_MIN_SHARED) continue;
    const [a, b] = splitPairKey(key);
    const degree = pairDegree(stats, a, b, shared);
    weighted.push({ pair: { a, b, shared, degree }, weight: (degree * shared) / (shared + COUPLING_EVIDENCE_HALF) });
  }
  weighted.sort((x, y) => y.weight - x.weight);
  return weighted.map((w) => w.pair);
}

/** Takes rankPairs' order, so a thin coincidence cannot outrank a real pair. */
function strongestPartners(ranked: readonly PairSignal[]): Map<string, Partner> {
  const best = new Map<string, Partner>();
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
    ...score,
    commits: stats.commits,
    added: stats.added,
    deleted: stats.deleted,
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

/** Exported for the integration tests; the app's cache is sha-driven. */
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

  const thisMonth = monthIndex(Date.now() / 1000);
  const cached = cache.get(projectPath);
  // Folding only ever adds, so a model carried across a month boundary still
  // covers the window it was built for. Start over rather than let it drift.
  const prev = cached?.builtInMonth === thisMonth ? cached : undefined;
  if (prev && prev.lastSha === sha) return prev;

  let analysis: ProjectAnalysis;
  let touched: ReadonlySet<string> | undefined;
  if (prev && (await isAncestor(projectPath, prev.lastSha, sha))) {
    const commits = await readLog(projectPath, `${prev.lastSha}..${sha}`);
    touched = new Set(commits.flatMap((c) => c.files.map((f) => f.path)));
    foldCommits(prev.model, commits);
    analysis = prev;
  } else {
    // Nothing to fold onto: a first scan, a rewritten history, or a new month.
    const model = emptyModel();
    foldCommits(model, await readLog(projectPath, sha));
    analysis = { lastSha: sha, builtInMonth: thisMonth, model, complexity: new Map(), scores: new Map() };
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

