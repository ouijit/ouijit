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

export function getDriver(id: ChatAgentId): AgentDriver {
  return DRIVERS[id];
}
