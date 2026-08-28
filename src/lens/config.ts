import { randomUUID, type UUID } from 'node:crypto';
import { getGlobalSetting, setGlobalSetting } from '../db';
import { currentHealth } from '../healthCheck';
import { resolveLensAgent, type LensAgent } from './lensAgents';

export interface LensSummary {
  /**
   * Stable across a rename: a stored grouping records the lens that wrote it, and
   * the name has to be free to move without it.
   */
  id: UUID;
  name: string;
  instruction: string;
}

export interface LensInput {
  /** A claim to be editing an existing lens, not an id. Checked, never trusted. */
  id?: string;
  name: string;
  instruction: string;
}

interface StoredEntry {
  id?: UUID;
  name: string;
  instruction: string;
}

function isUUID(value: unknown): value is UUID {
  return typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function lensesKey(projectPath: string): string {
  return 'lens:list:' + projectPath;
}

/** An unreadable id is dropped, which leaves it to the backfill in `listLenses`. */
function parseLenses(raw: string | null | undefined): StoredEntry[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (entry): entry is { id?: unknown; name: string; instruction: string } =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { name?: unknown }).name === 'string' &&
          typeof (entry as { instruction?: unknown }).instruction === 'string',
      )
      .map((entry) => ({
        ...(isUUID(entry.id) ? { id: entry.id } : {}),
        name: entry.name,
        instruction: entry.instruction,
      }));
  } catch {
    return null;
  }
}

export async function listLenses(projectPath: string): Promise<LensSummary[]> {
  const stored = parseLenses(await getGlobalSetting(lensesKey(projectPath))) ?? [];
  const minted = stored.some((lens) => !lens.id);
  const lenses = stored.map((lens) => ({ ...lens, id: lens.id ?? randomUUID() }));

  // No schema to migrate, and an id minted per read would key nothing — so the
  // backfill is written back the first time a project's lenses are asked for.
  if (minted) await writeLenses(projectPath, lenses);
  return lenses;
}

async function writeLenses(projectPath: string, lenses: LensSummary[]): Promise<void> {
  await setGlobalSetting(lensesKey(projectPath), JSON.stringify(lenses));
}

export async function saveLens(projectPath: string, input: LensInput): Promise<LensSummary> {
  const lenses = await listLenses(projectPath);
  const at = input.id ? lenses.findIndex((lens) => lens.id === input.id) : -1;

  const lens: LensSummary = {
    id: at >= 0 ? lenses[at].id : randomUUID(),
    name: input.name.trim(),
    instruction: input.instruction.trim(),
  };

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
  return 'lens:agent:' + projectPath;
}

export async function getLensAgentChoice(projectPath: string): Promise<string | null> {
  return (await getGlobalSetting(lensAgentKey(projectPath))) || null;
}

async function resolveLensAgentFor(projectPath: string): Promise<LensAgent | null> {
  return resolveLensAgent(await getLensAgentChoice(projectPath), await currentHealth());
}

export async function setLensAgentChoice(projectPath: string, chosenId: string | null): Promise<{ success: boolean }> {
  await setGlobalSetting(lensAgentKey(projectPath), chosenId ?? '');
  return { success: true };
}

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
