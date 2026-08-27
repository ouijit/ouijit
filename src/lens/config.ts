/**
 * The lenses a project keeps, and the agent that writes them. In settings rather
 * than a table, since a list of two fields does not earn a schema. The keys say
 * `github:` because that is where lenses started, and renaming them would mean
 * migrating what every project has already stored.
 */

import { randomUUID } from 'node:crypto';
import { getGlobalSetting, setGlobalSetting } from '../db';
import { getCachedHealth, checkHealth } from '../healthCheck';
import { installedAgents, resolveLensAgent, type LensAgent, type LensAgentChoice } from './lensAgents';

export interface LensSummary {
  /**
   * Stable across every edit, including a rename: a stored grouping records the
   * lens that wrote it, and the name has to be free to move without it.
   */
  id: string;
  name: string;
  /** What the reader wants, in prose. The context is ours to supply. */
  instruction: string;
}

/** A lens on its way in. No id yet means there is no lens yet. */
export interface LensInput {
  id?: string;
  name: string;
  instruction: string;
}

export function lensesKey(projectPath: string): string {
  return 'github:lenses:' + projectPath;
}

/** Entries as stored, which for a lens written before ids carry no id. */
function parseLenses(raw: string | null | undefined): LensInput[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (entry): entry is LensInput =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as LensInput).name === 'string' &&
          typeof (entry as LensInput).instruction === 'string',
      )
      .map((entry) => ({
        ...(typeof entry.id === 'string' && entry.id ? { id: entry.id } : {}),
        name: entry.name,
        instruction: entry.instruction,
      }));
  } catch {
    return null;
  }
}

export async function listLenses(projectPath: string): Promise<LensSummary[]> {
  const stored = parseLenses(await getGlobalSetting(lensesKey(projectPath))) ?? [];
  if (stored.every((lens) => lens.id)) return stored as LensSummary[];

  // No schema to migrate, and an id minted per read would key nothing — so the
  // backfill is written back the first time a project's lenses are asked for.
  const withIds = stored.map((lens) => ({ ...lens, id: lens.id ?? randomUUID() }));
  await writeLenses(projectPath, withIds);
  return withIds;
}

async function writeLenses(projectPath: string, lenses: LensSummary[]): Promise<void> {
  await setGlobalSetting(lensesKey(projectPath), JSON.stringify(lenses));
}

/** Create a lens, or edit one in place. An input with no id is a new lens. */
export async function saveLens(projectPath: string, input: LensInput): Promise<LensSummary> {
  const lens: LensSummary = {
    id: input.id ?? randomUUID(),
    name: input.name.trim(),
    instruction: input.instruction.trim(),
  };
  const lenses = await listLenses(projectPath);
  const at = lenses.findIndex((l) => l.id === lens.id);

  // An edit keeps its place in the list.
  if (at >= 0) lenses[at] = lens;
  else lenses.push(lens);

  await writeLenses(projectPath, lenses);
  return lens;
}

export async function deleteLens(projectPath: string, id: string): Promise<{ success: boolean }> {
  const lenses = await listLenses(projectPath);
  await writeLenses(
    projectPath,
    lenses.filter((lens) => lens.id !== id),
  );
  return { success: true };
}

function lensAgentKey(projectPath: string): string {
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
 * Null when nothing is chosen and nothing is installed. Answered before the diff
 * is gathered, so a machine with no agent is told so rather than spending a
 * minute reading a change to fail at the spawn.
 */
async function resolveLensAgentFor(projectPath: string): Promise<LensAgent | null> {
  const health = getCachedHealth() ?? (await checkHealth());
  return resolveLensAgent(await getLensAgentChoice(projectPath), installedAgents(health));
}

export async function setLensAgentChoice(projectPath: string, choice: LensAgentChoice): Promise<{ success: boolean }> {
  await setGlobalSetting(lensAgentKey(projectPath), JSON.stringify(choice));
  return { success: true };
}

/**
 * The named lens and the agent that will write it, or why neither can be had.
 * Both kinds of diff start here, so the wording a reader sees when a lens cannot
 * run is the same wherever they asked from.
 */
export async function resolveLensRun(
  projectPath: string,
  lensId: string,
): Promise<{ lens: LensSummary; agent: LensAgent } | { error: string }> {
  const lens = (await listLenses(projectPath)).find((l) => l.id === lensId);
  if (!lens) return { error: 'That lens is no longer part of this project' };

  const agent = await resolveLensAgentFor(projectPath);
  if (!agent) {
    return { error: 'No supported agent is installed. A lens is written by Claude Code or Codex.' };
  }

  return { lens, agent };
}
