import { HOME_CHAT_ID } from '../../chat/preferences';
import { ChatView } from './ChatView';

/** The app-wide chat on screen. Its name and settings sit in the title bar, as a project's do. */
export function HomeChatView() {
  return (
    <div
      className="flex flex-col h-full transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      <ChatView cardId={HOME_CHAT_ID} surface="page" />
    </div>
  );
}
