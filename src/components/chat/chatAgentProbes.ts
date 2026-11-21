import { useEffect, useState } from 'react';
import type { DriverProbe } from '../../chat/driver';
import { CHAT_AGENT_IDS, type ChatAgentId } from '../../chat/model';

export type AgentProbes = Partial<Record<ChatAgentId, DriverProbe>>;

export function useAgentProbes(): AgentProbes {
  const [probes, setProbes] = useState<AgentProbes>({});
  useEffect(() => {
    for (const agent of CHAT_AGENT_IDS) {
      if (agent === 'acp') continue;
      void window.api.chat.probe(agent).then((probe) => setProbes((current) => ({ ...current, [agent]: probe })));
    }
  }, []);
  return probes;
}

export function agentHint(agent: ChatAgentId, probes: AgentProbes): string | undefined {
  if (agent === 'acp') return undefined;
  return probes[agent]?.installed === false ? 'Not installed' : probes[agent]?.version;
}
