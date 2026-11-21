import type { DriverProbe } from '../../chat/driver';
import type { ChatAgentId } from '../../chat/model';

export type AgentProbes = Partial<Record<ChatAgentId, DriverProbe>>;

export function agentHint(agent: ChatAgentId, probes: AgentProbes): string | undefined {
  if (agent === 'acp') return undefined;
  return probes[agent]?.installed === false ? 'Not installed' : probes[agent]?.version;
}
