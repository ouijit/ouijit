import { ToggleRow } from '../ui/SettingsRows';
import { CHAT_SETTING_KEYS } from '../../chat/preferences';
import { setChatEnabled } from './chatActions';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { MainChatSettings, PANEL } from './MainChatSettings';

export function ChatSettingsSection() {
  const enabled = useHomeChatStore((s) => s.enabled);
  return (
    <>
      <div className={PANEL}>
        <ToggleRow
          label="Chat"
          description="Experimental. A conversation that runs your tasks across projects, and tasks that open as a chat."
          checked={enabled}
          onChange={() => {
            void window.api.globalSettings.set(CHAT_SETTING_KEYS.enabled, enabled ? '' : '1');
            void setChatEnabled(!enabled);
          }}
        />
      </div>
      {enabled && <MainChatSettings />}
    </>
  );
}
