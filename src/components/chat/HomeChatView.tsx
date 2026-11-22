import { useEffect } from 'react';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { ChatView } from './ChatView';
import { HomeChatDecisions } from './HomeChatDecisions';
import { ManagedTasks } from './ManagedTasks';
import { TerminalBody } from '../terminal/TerminalBody';
import { ContextMenu } from '../ui/ContextMenu';
import { useAddPanelMenu } from '../terminal/addPanelMenuStore';
import { terminalInstances } from '../terminal/terminalRegistry';
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
          <AddMenu ptyId={currentId} />
        </div>
      )}
    </div>
  );
}

/** A conversation has no project, so no scripts: what it can open beside itself is a file or a page. */
function AddMenu({ ptyId }: { ptyId: string }) {
  const open = useAddPanelMenu((s) => (s.open?.ptyId === ptyId ? s.open : null));
  const close = useAddPanelMenu((s) => s.close);
  if (!open) return null;
  const host = () => terminalInstances.get(ptyId);
  return (
    <ContextMenu
      x={open.x}
      y={open.y}
      onClose={close}
      items={[
        { label: 'Web Preview', icon: 'globe-simple', onClick: () => host()?.addWebPreviewPanel(null) },
        {
          label: 'Markdown File',
          icon: 'file-text',
          onClick: () =>
            void window.api.plan.pickFile(host()?.worktreePath).then((result) => {
              if (!result.canceled && result.filePath) host()?.addPlanPanel(result.filePath);
            }),
        },
      ]}
    />
  );
}
