import type { AgentDriver } from '../driver';
import type { ChatAgentId } from '../model';
import { claudeDriver } from './claude';
import { codexDriver } from './codex';
import { piDriver } from './pi';
import { opencodeDriver } from './opencode';
import { acpDriver } from './acp';

const DRIVERS: Record<ChatAgentId, AgentDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  pi: piDriver,
  opencode: opencodeDriver,
  acp: acpDriver,
};

let overrides: Partial<Record<ChatAgentId, AgentDriver>> = {};

export function getDriver(id: ChatAgentId): AgentDriver {
  return overrides[id] ?? DRIVERS[id];
}

export function listDrivers(): AgentDriver[] {
  return Object.keys(DRIVERS).map((id) => getDriver(id as ChatAgentId));
}

/** Test-only: run a recorded or fake driver in place of a real agent. */
export function _overrideDriverForTesting(id: ChatAgentId, driver: AgentDriver | null): void {
  overrides = { ...overrides, [id]: driver ?? undefined };
}
