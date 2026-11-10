import { useHomeChatStore } from '../../stores/homeChatStore';
import { ChatView } from './ChatView';

/** Chat's current conversation on screen. Its title and settings sit in the title bar, as a project's do. */
export function HomeChatView() {
  const currentId = useHomeChatStore((s) => s.currentId);
  return (
    <div
      className="flex flex-col h-full transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      {currentId && (
        <div key={currentId} className="chat-swap-in flex-1 min-h-0 flex flex-col">
          <ChatView cardId={currentId} surface="page" />
        </div>
      )}
    </div>
  );
}
