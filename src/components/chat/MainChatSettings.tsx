import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';
import { DEFAULT_HOME_CHAT_INSTRUCTIONS } from '../../chat/homeChatInstructions';
import {
  DEFAULT_HOME_CHAT_SETTINGS,
  HOME_CHAT_SETTING_KEYS,
  WAKE_EVENTS,
  WAKE_EVENT_LABELS,
  parseHomeChatSettings,
  type HomeChatSettings,
  type WakeEvent,
} from '../../chat/preferences';
import type { ChatAgentId } from '../../chat/model';
import {
  SANDBOX_LABELS,
  SANDBOX_PROVIDER_IDS,
  isSandboxCliAccess,
  sandboxCliAccessSettingKey,
  type SandboxCliAccess,
  type SandboxProviderId,
} from '../../sandbox/types';
import { AgentPicker } from './AgentPicker';
import { SandboxProfileRow } from '../scripts/SandboxProfileRow';
import { CustomLauncherRow } from '../scripts/CustomLauncherRow';
import { CliAccessRow } from '../scripts/SandboxSection';
import { ToggleRow } from '../ui/SettingsRows';

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

export const PANEL =
  'glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg';

export function MainChatSettings() {
  const [settings, setSettings] = useState<HomeChatSettings>(DEFAULT_HOME_CHAT_SETTINGS);
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    void loadHomeChatSettings().then((loaded) => {
      setSettings(loaded);
      setInstructions(loaded.instructions);
    });
  }, []);

  const [chatDir, setChatDir] = useState<string | null>(null);
  const [cliAccess, setCliAccess] = useState<SandboxCliAccess>('read');
  useEffect(() => {
    void window.api.homeChat.dir().then(async (dir) => {
      setChatDir(dir);
      const stored = await window.api.globalSettings.get(sandboxCliAccessSettingKey(dir));
      if (isSandboxCliAccess(stored)) setCliAccess(stored);
    });
  }, []);

  const restart = async () => {
    try {
      useChatStore.getState().adopt(await window.api.homeChat.restart());
    } catch (error) {
      useProjectStore.getState().addToast(String(error), 'error');
    }
  };

  /** Agent, sandbox and instructions reach the agent only at launch, so a change restarts it. */
  const save = async (key: keyof typeof HOME_CHAT_SETTING_KEYS, stored: string, restarts: boolean) => {
    await window.api.globalSettings.set(HOME_CHAT_SETTING_KEYS[key], stored);
    if (restarts) await restart();
  };

  const setAgent = (agent: ChatAgentId) => {
    setSettings((current) => ({ ...current, agent }));
    void save('agent', agent, true);
  };
  const setSandbox = (sandbox: SandboxProviderId) => {
    setSettings((current) => ({ ...current, sandbox }));
    void save('sandbox', sandbox, true);
  };
  const commitInstructions = (text = instructions) => {
    const next = text.trim();
    if (next === settings.instructions) return;
    setSettings((current) => ({ ...current, instructions: next }));
    void save('instructions', next, true);
  };
  const restoreInstructions = () => {
    setInstructions(DEFAULT_HOME_CHAT_INSTRUCTIONS);
    commitInstructions(DEFAULT_HOME_CHAT_INSTRUCTIONS);
  };
  const toggleWake = (event: WakeEvent) => {
    const wake = { ...settings.wake, [event]: !settings.wake[event] };
    setSettings((current) => ({ ...current, wake }));
    void save('wake', JSON.stringify(wake), false);
  };

  return (
    <section aria-label="Main chat" className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Main chat</h3>
        <p className="text-xs text-text-tertiary mt-1">
          Changing its agent, where it runs, or its instructions restarts it on the same conversation.
        </p>
      </div>

      <div className={PANEL}>
        <AgentPicker agent={settings.agent} ariaLabel="Choose the main chat's agent" onChange={setAgent} />
        <Row
          label="Run in"
          description={
            settings.sandbox === 'none'
              ? 'On your computer.'
              : settings.sandbox === 'nono'
                ? 'Reads every project, and changes only what its profile allows.'
                : 'Inside your launcher.'
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
        {settings.sandbox === 'nono' && chatDir && (
          <SandboxProfileRow projectPath={chatDir} onChange={() => void restart()} />
        )}
        {settings.sandbox === 'custom' && chatDir && (
          <CustomLauncherRow projectPath={chatDir} onChange={() => void restart()} />
        )}
        {settings.sandbox !== 'none' && chatDir && (
          <CliAccessRow
            value={cliAccess}
            levels={['read', 'all']}
            onChange={(level) => {
              setCliAccess(level);
              void window.api.globalSettings.set(sandboxCliAccessSettingKey(chatDir), level).then(() => restart());
            }}
          />
        )}
      </div>

      <div>
        <div className="flex items-center gap-3 mb-1">
          <h4 className="flex-1 text-sm text-text-primary">Instructions</h4>
          {instructions.trim() !== DEFAULT_HOME_CHAT_INSTRUCTIONS && (
            <button
              type="button"
              className="text-xs text-text-tertiary hover:text-text-primary transition-colors duration-100"
              onClick={restoreInstructions}
            >
              Restore default
            </button>
          )}
        </div>
        <p className="text-xs text-text-tertiary mb-3">
          Read at the start of every conversation, after what Ouijit tells it about running work here.
        </p>
        <textarea
          aria-label="Main chat instructions"
          className="field w-full min-h-[16rem] font-mono text-[12px] leading-relaxed resize-y"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          onBlur={() => commitInstructions()}
        />
      </div>

      <div>
        <h4 className="text-sm text-text-primary mb-1">Wake on</h4>
        <p className="text-xs text-text-tertiary mb-3">
          What arrives in the chat as a message without you asking. All off, it speaks only when spoken to.
        </p>
        <div className={PANEL}>
          {WAKE_EVENTS.map((event) => (
            <ToggleRow
              key={event}
              label={WAKE_EVENT_LABELS[event]}
              checked={settings.wake[event]}
              onChange={() => toggleWake(event)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
