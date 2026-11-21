import type { AgentClient, AgentDriver } from '../driver';
import type { ChatAgentId } from '../model';
import { claudeDriver } from './claude';
import { codexDriver } from './codex';
import { piDriver } from './pi';
import { opencodeDriver } from './opencode';
import { acpDriver } from './acp';

export function createDrivers(client: AgentClient): Record<ChatAgentId, AgentDriver> {
  return {
    claude: claudeDriver(client),
    codex: codexDriver(client),
    pi: piDriver(client),
    opencode: opencodeDriver(client),
    acp: acpDriver(client),
  };
}
