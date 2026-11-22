import { useEffect } from 'react';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { ChatView } from './ChatView';
import { HomeChatDecisions } from './HomeChatDecisions';
import { ManagedTasks } from './ManagedTasks';
import { TerminalBody } from '../terminal/TerminalBody';
import { homePanelHost } from './homeChatPanels';

/** Chat's current conversation on screen, with what it has open beside it. Its title sits in the title bar, as a project's does. */
export function HomeChatView() {
  const currentId = useHomeChatStore((s) => s.currentId);
  const projectPath = useTerminalStore((s) => (currentId ? s.displayStates[currentId]?.projectPath : undefined));
  useEffect(() => {
    if (currentId) void homePanelHost(currentId);
  }, [currentId]);
  const footer = currentId && <HomeChatDecisions conversation={currentId} />;
  const aboveComposer = currentId && <ManagedTasks conversation={currentId} />;
  return (
    <div
      className="flex flex-col h-full transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      {currentId && (
        <div key={currentId} className="chat-swap-in flex-1 min-h-0 flex flex-col">
          {projectPath ? (
            <TerminalBody ptyId={currentId} projectPath={projectPath} page={{ footer, aboveComposer }} />
          ) : (
            <ChatView cardId={currentId} surface="page" footer={footer} aboveComposer={aboveComposer} />
          )}
        </div>
      )}
    </div>
  );
}
