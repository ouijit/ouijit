import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useEscape } from '../../hooks/useEscape';
import { SettingsDropdown, SettingsDropdownOption } from '../ui/SettingsDropdown';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';
import {
  CHAT_AGENT_LABELS,
  DEFAULT_HOME_CHAT_SETTINGS,
  HOME_CHAT_SETTING_KEYS,
  WAKE_EVENTS,
  WAKE_EVENT_LABELS,
  parseHomeChatSettings,
  type HomeChatSettings,
  type WakeEvent,
} from '../../chat/preferences';
import { CHAT_AGENT_IDS, type ChatAgentId } from '../../chat/model';
import { SANDBOX_LABELS, SANDBOX_PROVIDER_IDS, type SandboxProviderId } from '../../sandbox/types';
import type { DriverProbe } from '../../chat/driver';

async function loadHomeChatSettings(): Promise<HomeChatSettings> {
  const values = new Map<string, string | undefined>();
  await Promise.all(
    Object.values(HOME_CHAT_SETTING_KEYS).map(async (key) => values.set(key, await window.api.globalSettings.get(key))),
  );
  return parseHomeChatSettings((key) => values.get(key));
}

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

const PANEL =
  'glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg';

export function HomeChatSettingsPanel() {
  const [settings, setSettings] = useState<HomeChatSettings>(DEFAULT_HOME_CHAT_SETTINGS);
  const [probes, setProbes] = useState<Partial<Record<ChatAgentId, DriverProbe>>>({});
  const [agentOpen, setAgentOpen] = useState(false);
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    void loadHomeChatSettings().then((loaded) => {
      setSettings(loaded);
      setInstructions(loaded.instructions);
    });
    for (const agent of CHAT_AGENT_IDS) {
      if (agent === 'acp') continue;
      void window.api.chat.probe(agent).then((probe) => setProbes((current) => ({ ...current, [agent]: probe })));
    }
  }, []);

  useEscape(useCallback(() => useAppStore.getState().leaveSettings(), []));

  /** Agent, sandbox and instructions reach the agent only at launch, so a change restarts it. */
  const save = async (key: keyof typeof HOME_CHAT_SETTING_KEYS, stored: string, restart: boolean) => {
    await window.api.globalSettings.set(HOME_CHAT_SETTING_KEYS[key], stored);
    if (!restart) return;
    try {
      useChatStore.getState().adopt(await window.api.homeChat.restart());
    } catch (error) {
      useProjectStore.getState().addToast(String(error), 'error');
    }
  };

  const setAgent = (agent: ChatAgentId) => {
    setSettings((current) => ({ ...current, agent }));
    void save('agent', agent, true);
  };
  const setSandbox = (sandbox: SandboxProviderId) => {
    setSettings((current) => ({ ...current, sandbox }));
    void save('sandbox', sandbox, true);
  };
  const commitInstructions = () => {
    const next = instructions.trim();
    if (next === settings.instructions) return;
    setSettings((current) => ({ ...current, instructions: next }));
    void save('instructions', next, true);
  };
  const toggleWake = (event: WakeEvent) => {
    const wake = { ...settings.wake, [event]: !settings.wake[event] };
    setSettings((current) => ({ ...current, wake }));
    void save('wake', JSON.stringify(wake), false);
  };

  const probe = probes[settings.agent];

  return (
    <div
      className="flex flex-col h-full transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      <div
        className="pointer-events-none h-6 shrink-0 -mb-6 relative z-10"
        style={{ background: 'linear-gradient(to bottom, var(--color-background), transparent)' }}
      />
      <div className="flex-1 overflow-y-auto settings-scrollable">
        <div className="px-6 pt-4 pb-16 min-w-full max-w-2xl space-y-8">
          <div>
            <h1 className="text-base font-semibold text-text-primary">Chat settings</h1>
            <p className="text-xs text-text-tertiary mt-1">
              Changing the agent, where it runs, or its instructions restarts the agent on the same conversation.
            </p>
          </div>

          <section className={PANEL}>
            <Row
              label="Agent"
              description={
                probe?.problem ?? (probe?.version ? `${CHAT_AGENT_LABELS[settings.agent]} ${probe.version}` : undefined)
              }
            >
              <SettingsDropdown
                open={agentOpen}
                onOpenChange={setAgentOpen}
                widthClass="w-[13rem]"
                ariaLabel="Choose the chat agent"
                triggerLabel={CHAT_AGENT_LABELS[settings.agent]}
              >
                {CHAT_AGENT_IDS.map((agent) => (
                  <SettingsDropdownOption
                    key={agent}
                    label={CHAT_AGENT_LABELS[agent]}
                    hint={
                      agent === 'acp'
                        ? undefined
                        : probes[agent]?.installed === false
                          ? 'Not installed'
                          : probes[agent]?.version
                    }
                    selected={settings.agent === agent}
                    onClick={() => {
                      setAgentOpen(false);
                      setAgent(agent);
                    }}
                  />
                ))}
              </SettingsDropdown>
            </Row>
            <Row
              label="Run in"
              description={
                settings.sandbox === 'none'
                  ? 'On your computer, asking before it acts, as its mode is set.'
                  : 'Everything Ouijit can do, with no approvals. The sandbox decides what else it may touch.'
              }
            >
              <SegmentedGroup>
                {SANDBOX_PROVIDER_IDS.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    aria-pressed={settings.sandbox === provider}
                    className={`${segmentBase} ${settings.sandbox === provider ? segmentAccent : segmentQuiet}`}
                    onClick={() => setSandbox(provider)}
                  >
                    {SANDBOX_LABELS[provider]}
                  </button>
                ))}
              </SegmentedGroup>
            </Row>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-1">Instructions</h2>
            <p className="text-xs text-text-tertiary mb-3">
              Read at the start of every conversation, after what Ouijit tells it about running work here.
            </p>
            <textarea
              aria-label="Chat instructions"
              className="field w-full min-h-[9rem] font-mono text-[12px] leading-relaxed resize-y"
              placeholder="Approve installs and test runs for a worker. Come to me for anything touching main."
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              onBlur={commitInstructions}
            />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-1">Wake on</h2>
            <p className="text-xs text-text-tertiary mb-3">
              What arrives in the chat as a message without you asking. All off, it speaks only when spoken to.
            </p>
            <div className={PANEL}>
              {WAKE_EVENTS.map((event) => (
                <label
                  key={event}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-ink/[0.02]"
                >
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={settings.wake[event]}
                    onChange={() => toggleWake(event)}
                  />
                  {WAKE_EVENT_LABELS[event]}
                </label>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
