import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { gitAsync, getMainBranchAsync } from '../git';
import { getGlobalSetting } from '../db';
import { experimentalStorageKey, parseExperimentalFlags } from '../experimentalFlags';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import { readLog } from './gitLog';
import { emptyModel, foldCommits, splitPairKey, COUPLING_MIN_SHARED, type AnalysisModel } from './accumulate';
import { complexityOf } from './complexity';
import { scoreFiles, type FileScore } from './score';
import type { AnalysisStatus, CouplingSignal, DiffSignals, FileComplexitySignal, FileSignal } from './types';

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

  const files: Record<string, FileSignal> = {};
  for (const p of paths) {
    const stats = analysis.model.files.get(p);
    if (!stats) continue;

    const byEmail = analysis.model.authors.get(p);
    let mainAuthor: string | null = null;
    let mainCommits = 0;
    if (byEmail) {
      for (const author of byEmail.values()) {
        if (author.commits > mainCommits) {
          mainCommits = author.commits;
          mainAuthor = author.name;
        }
      }
    }

    const score = analysis.scores.get(p);
    files[p] = {
      commits: stats.commits,
      added: stats.added,
      deleted: stats.deleted,
      firstAt: stats.firstAt,
      lastAt: stats.lastAt,
      score: score?.score ?? 0,
      tier: score?.tier ?? 'quiet',
      mainAuthor,
      ownership: stats.commits > 0 ? mainCommits / stats.commits : 0,
      authors: byEmail?.size ?? 0,
      complexity: analysis.complexity.get(p) ?? null,
    };
  }

  const asked = new Set(paths);
  const couplings: CouplingSignal[] = [];
  for (const [key, shared] of analysis.model.couplings) {
    if (shared < COUPLING_MIN_SHARED) continue;
    const [a, b] = splitPairKey(key);
    const inA = asked.has(a);
    const inB = asked.has(b);
    if (!inA && !inB) continue;
    const degree =
      shared / Math.max(analysis.model.files.get(a)?.commits ?? shared, analysis.model.files.get(b)?.commits ?? shared);
    if (inA) couplings.push({ path: a, partner: b, shared, degree });
    if (inB) couplings.push({ path: b, partner: a, shared, degree });
  }

  return { files, couplings };
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
