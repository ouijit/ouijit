/**
 * The lenses a project keeps, and the agent that writes them.
 *
 * A lens is a way of reading one change — the parts of it, named and ordered.
 * What is reusable is the prompt that finds them, never the grouping it
 * produces, so this is where reuse lives and a project keeps as many as it has
 * ways of reading a change: one for a refactor, one for a feature, one that
 * goes looking for what the tests do not cover.
 *
 * Kept in settings rather than a table: it was one command in settings before
 * it was a list, and a list of two fields does not earn a schema. The keys
 * still say `github:` because that is where lenses started and renaming them
 * would mean migrating what every project has already stored.
 */

import { getGlobalSetting, setGlobalSetting, renameDiffLens } from '../db';
import { getCachedHealth, checkHealth } from '../healthCheck';
import { installedAgents, resolveLensAgent, type LensAgent, type LensAgentChoice } from './lensAgents';

export interface LensSummary {
  name: string;
  /** What the reader wants, in prose. The context is ours to supply. */
  instruction: string;
}

export function lensesKey(projectPath: string): string {
  return 'github:lenses:' + projectPath;
}

function parseLenses(raw: string | null | undefined): LensSummary[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (entry): entry is LensSummary =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as LensSummary).name === 'string' &&
          typeof (entry as LensSummary).instruction === 'string',
      )
      .map((entry) => ({ name: entry.name, instruction: entry.instruction }));
  } catch {
    return null;
  }
}

export async function listLenses(projectPath: string): Promise<LensSummary[]> {
  return parseLenses(await getGlobalSetting(lensesKey(projectPath))) ?? [];
}

export async function writeLenses(projectPath: string, lenses: LensSummary[]): Promise<void> {
  await setGlobalSetting(lensesKey(projectPath), JSON.stringify(lenses));
}

/**
 * Create or rename a lens.
 *
 * Keyed by name, so an edit that changes the name would otherwise leave the old
 * one behind as a duplicate — the caller passes what it was called and the
 * rename happens here, in one call.
 */
export async function saveLens(
  projectPath: string,
  name: string,
  instruction: string,
  previousName?: string,
): Promise<LensSummary> {
  const lens: LensSummary = { name: name.trim(), instruction: instruction.trim() };
  const lenses = await listLenses(projectPath);
  const without = lenses.filter((l) => l.name !== lens.name && l.name !== previousName);
  const at = previousName ? lenses.findIndex((l) => l.name === previousName) : -1;

  // A rename keeps its place in the list. Sending it to the bottom would make
  // renaming feel like deleting and adding, which is what it must not be.
  if (at >= 0) without.splice(Math.min(at, without.length), 0, lens);
  else without.push(lens);

  await writeLenses(projectPath, without);

  // Anything already read through it is still being read through it, whatever
  // it is now called — on both diffs a lens can be applied to.
  if (previousName && previousName !== lens.name) await renameDiffLens(projectPath, previousName, lens.name);

  return lens;
}

export async function deleteLens(projectPath: string, name: string): Promise<{ success: boolean }> {
  const lenses = await listLenses(projectPath);
  await writeLenses(
    projectPath,
    lenses.filter((lens) => lens.name !== name),
  );
  return { success: true };
}

export function lensAgentKey(projectPath: string): string {
  return 'github:lens-agent:' + projectPath;
}

export async function getLensAgentChoice(projectPath: string): Promise<LensAgentChoice> {
  const raw = await getGlobalSetting(lensAgentKey(projectPath));
  if (!raw) return { agentId: null };
  try {
    const parsed = JSON.parse(raw) as Partial<LensAgentChoice>;
    return { agentId: typeof parsed.agentId === 'string' ? parsed.agentId : null };
  } catch {
    return { agentId: null };
  }
}

/**
 * The agent this project's lenses run through, resolved against what is here.
 *
 * Null when nothing is chosen and nothing is installed — answered before the
 * diff is gathered, so a machine with no agent on it is told that rather than
 * spending a minute reading a change to fail at the spawn.
 */
export async function resolveLensAgentFor(projectPath: string): Promise<LensAgent | null> {
  const health = getCachedHealth() ?? (await checkHealth());
  return resolveLensAgent(await getLensAgentChoice(projectPath), installedAgents(health));
}

export async function setLensAgentChoice(projectPath: string, choice: LensAgentChoice): Promise<{ success: boolean }> {
  await setGlobalSetting(lensAgentKey(projectPath), JSON.stringify(choice));
  return { success: true };
}

/**
 * The named lens and the agent that will write it, or why neither can be had.
 *
 * The pull request and the worktree diff both start here, so the wording a
 * reader sees when a lens cannot run is the same wherever they asked from.
 */
export async function resolveLensRun(
  projectPath: string,
  lensName: string,
): Promise<{ lens: LensSummary; agent: LensAgent } | { error: string }> {
  const lens = (await listLenses(projectPath)).find((l) => l.name === lensName);
  if (!lens) return { error: `No lens called “${lensName}”` };

  const agent = await resolveLensAgentFor(projectPath);
  if (!agent) {
    return { error: 'No supported agent is installed. A lens is written by Claude Code or Codex.' };
  }

  return { lens, agent };
}
