import { useEffect, useState } from 'react';
import { SettingsDropdown, SettingsDropdownOption } from '../ui/SettingsDropdown';
import { ToggleRow } from '../ui/SettingsRows';
import { CHAT_AGENT_LABELS, CHAT_SETTING_KEYS } from '../../chat/preferences';
import { CHAT_AGENT_IDS, type ChatAgentId } from '../../chat/model';
import { loadChatSettings } from '../../services/chatSettings';
import { agentHint, useAgentProbes } from './chatAgentProbes';

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        {description && <div className="text-xs text-text-tertiary mt-0.5">{description}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * An agent choice, as rows in a settings panel, with what that agent alone
 * needs set under it. Those options are the agent's wherever it runs, so the
 * main chat and every project show the same values.
 */
export function AgentPicker({
  agent,
  ariaLabel,
  onChange,
}: {
  agent: ChatAgentId;
  ariaLabel: string;
  onChange: (agent: ChatAgentId) => void;
}) {
  const probes = useAgentProbes();
  const [open, setOpen] = useState(false);
  const [piApprovals, setPiApprovals] = useState(false);
  const [acpCommand, setAcpCommand] = useState('');
  useEffect(() => {
    void loadChatSettings().then((loaded) => {
      setPiApprovals(loaded.piApprovals);
      setAcpCommand(loaded.acpCommand);
    });
  }, []);
  const probe = probes[agent];

  return (
    <>
      <Row
        label="Agent"
        description={probe?.problem ?? (probe?.version ? `${CHAT_AGENT_LABELS[agent]} ${probe.version}` : undefined)}
      >
        <SettingsDropdown
          open={open}
          onOpenChange={setOpen}
          widthClass="w-[13rem]"
          ariaLabel={ariaLabel}
          triggerLabel={CHAT_AGENT_LABELS[agent]}
        >
          {CHAT_AGENT_IDS.map((id) => (
            <SettingsDropdownOption
              key={id}
              label={CHAT_AGENT_LABELS[id]}
              hint={agentHint(id, probes)}
              selected={agent === id}
              onClick={() => {
                setOpen(false);
                onChange(id);
              }}
            />
          ))}
        </SettingsDropdown>
      </Row>
      {agent === 'pi' && (
        <ToggleRow
          label="Ask before Pi runs tools"
          description="Pi runs tools without asking. This adds an approval before each one, in chat."
          checked={piApprovals}
          onChange={() => {
            const next = !piApprovals;
            setPiApprovals(next);
            void window.api.globalSettings.set(CHAT_SETTING_KEYS.piApprovals, next ? '1' : '');
          }}
        />
      )}
      {agent === 'acp' && (
        <Row label="ACP agent command" description="Any agent that speaks the Agent Client Protocol over stdio.">
          <input
            className="field w-[16rem] font-mono text-[12px]"
            placeholder="gemini --experimental-acp"
            value={acpCommand}
            onChange={(event) => setAcpCommand(event.target.value)}
            onBlur={() => void window.api.globalSettings.set(CHAT_SETTING_KEYS.acpCommand, acpCommand.trim())}
          />
        </Row>
      )}
    </>
  );
}
