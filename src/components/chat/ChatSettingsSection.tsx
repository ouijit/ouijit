import { useEffect, useState } from 'react';
import { SettingsDropdown, SettingsDropdownOption } from '../ui/SettingsDropdown';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';
import { ToggleRow } from '../ui/SettingsRows';
import {
  CHAT_AGENT_LABELS,
  CHAT_SETTING_KEYS,
  DEFAULT_CHAT_SETTINGS,
  type ChatSettings,
  type TaskSurface,
} from '../../chat/preferences';
import { CHAT_AGENT_IDS, type ChatAgentId } from '../../chat/model';
import { agentHint, type AgentProbes } from './chatAgentProbes';
import { MainChatSettings, PANEL } from './MainChatSettings';
import { setChatEnabled } from './chatActions';
import { loadChatSettings } from '../../services/chatSettings';
import { useHomeChatStore } from '../../stores/homeChatStore';

function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-0.5">{description}</div>
      </div>
      {children}
    </div>
  );
}

export function ChatSettingsSection() {
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [probes, setProbes] = useState<AgentProbes>({});
  const [mainAgent, setMainAgent] = useState<ChatAgentId | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [acpDraft, setAcpDraft] = useState('');

  useEffect(() => {
    void loadChatSettings().then((loaded) => {
      setSettings(loaded);
      setAcpDraft(loaded.acpCommand);
    });
    for (const agent of CHAT_AGENT_IDS) {
      if (agent === 'acp') continue;
      void window.api.chat.probe(agent).then((probe) => setProbes((current) => ({ ...current, [agent]: probe })));
    }
  }, []);

  const save = <K extends keyof ChatSettings>(key: K, value: ChatSettings[K], stored: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
    void window.api.globalSettings.set(CHAT_SETTING_KEYS[key], stored);
  };

  const enabled = useHomeChatStore((s) => s.enabled);
  const probe = probes[settings.agent];
  const uses = (agent: ChatAgentId) => settings.agent === agent || mainAgent === agent;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-4">Chat</h2>
        <div className={PANEL}>
          <ToggleRow
            label="Chat"
            description="Experimental. A conversation that runs your tasks across projects, and tasks that open as a chat."
            checked={enabled}
            onChange={() => {
              save('enabled', !enabled, enabled ? '' : '1');
              void setChatEnabled(!enabled);
            }}
          />
          {enabled && uses('pi') && (
            <ToggleRow
              label="Ask before Pi runs tools"
              description="Pi runs tools without asking. This adds an approval before each one, in chat."
              checked={settings.piApprovals}
              onChange={() => save('piApprovals', !settings.piApprovals, settings.piApprovals ? '' : '1')}
            />
          )}
          {enabled && uses('acp') && (
            <Row label="ACP agent command" description="Any agent that speaks the Agent Client Protocol over stdio.">
              <input
                className="field w-[16rem] font-mono text-[12px]"
                placeholder="gemini --experimental-acp"
                value={acpDraft}
                onChange={(event) => setAcpDraft(event.target.value)}
                onBlur={() => save('acpCommand', acpDraft.trim(), acpDraft.trim())}
              />
            </Row>
          )}
        </div>
      </div>
      {enabled && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Task chats</h3>
            <div className={PANEL}>
              <Row label="Open tasks in" description="A task can have more of either, from its menu.">
                <SegmentedGroup>
                  {(['terminal', 'chat'] as TaskSurface[]).map((surface) => (
                    <button
                      key={surface}
                      type="button"
                      aria-pressed={settings.surface === surface}
                      className={`${segmentBase} ${settings.surface === surface ? segmentAccent : segmentQuiet}`}
                      onClick={() => {
                        save('surface', surface, surface);
                        useHomeChatStore.getState().setTaskSurface(surface);
                      }}
                    >
                      {surface === 'chat' ? 'Chat' : 'Terminal'}
                    </button>
                  ))}
                </SegmentedGroup>
              </Row>
              <Row
                label="Agent"
                description={
                  probe?.problem ??
                  (probe?.version
                    ? `${CHAT_AGENT_LABELS[settings.agent]} ${probe.version}`
                    : 'The agent a new task chat runs.')
                }
              >
                <SettingsDropdown
                  open={agentOpen}
                  onOpenChange={setAgentOpen}
                  widthClass="w-[13rem]"
                  ariaLabel="Choose the task chat agent"
                  triggerLabel={CHAT_AGENT_LABELS[settings.agent]}
                >
                  {CHAT_AGENT_IDS.map((agent) => (
                    <SettingsDropdownOption
                      key={agent}
                      label={CHAT_AGENT_LABELS[agent]}
                      hint={agentHint(agent, probes)}
                      selected={settings.agent === agent}
                      onClick={() => {
                        setAgentOpen(false);
                        save('agent', agent, agent);
                      }}
                    />
                  ))}
                </SettingsDropdown>
              </Row>
            </div>
          </div>
          <MainChatSettings probes={probes} onAgentChange={setMainAgent} />
        </>
      )}
    </section>
  );
}
