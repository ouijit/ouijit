import { useTerminalStore } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { Icon } from '../terminal/Icon';
import { SegmentedGroup, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';
import { switchToChat, switchToTerminal } from './chatActions';
import type { TaskSurface } from '../../chat/preferences';

/**
 * Which view a card's conversation is in, floating over that view. Only a card
 * that is or has been a chat has one. The choice shows as soon as it is made;
 * a switch mid-turn waits for the turn to end.
 */
export function SurfaceToggle({ ptyId }: { ptyId: string }) {
  const surface = useTerminalStore((s) => s.displayStates[ptyId]?.surface ?? 'terminal');
  const chatAgent = useTerminalStore((s) => s.displayStates[ptyId]?.chatAgent ?? null);
  const switching = useTerminalStore((s) => s.displayStates[ptyId]?.switching ?? null);
  const terminalBusy = useTerminalStore((s) => s.displayStates[ptyId]?.status === 'thinking');
  const chatBusy = useChatStore((s) => {
    const status = s.sessions[ptyId]?.info.status;
    return status === 'running' || status === 'awaiting';
  });
  if (!chatAgent) return null;

  const shown = switching ?? surface;
  const waitingOnTurn = switching === 'terminal' ? chatBusy : switching === 'chat' ? terminalBusy : false;
  const choose = (next: TaskSurface) => {
    if (next === surface) return;
    void (next === 'terminal' ? switchToTerminal(ptyId) : switchToChat(ptyId));
  };

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
      {switching && (
        <span className="flex items-center gap-2 text-[12px] text-text-tertiary">
          {waitingOnTurn ? 'Switching when this turn ends' : `Opening ${switching}…`}
          {waitingOnTurn && switching === 'terminal' && (
            <button
              type="button"
              className="text-text-secondary hover:text-text-primary transition-colors duration-100"
              onClick={() => void window.api.chat.interrupt(ptyId)}
            >
              Stop now
            </button>
          )}
        </span>
      )}
      <div role="radiogroup" aria-label="View">
        <SegmentedGroup placement="over">
          {(['chat', 'terminal'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={shown === option}
              aria-label={option === 'chat' ? 'Chat' : 'Terminal'}
              disabled={switching !== null}
              className={`${segmentBase} ${shown === option ? 'bg-background-tertiary text-text-primary' : segmentQuiet}`}
              onClick={() => choose(option)}
            >
              <Icon name={option === 'chat' ? 'chat-circle' : 'terminal'} className="w-3.5 h-3.5" />
            </button>
          ))}
        </SegmentedGroup>
      </div>
    </div>
  );
}
