import { useTerminalStore } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { Icon } from '../terminal/Icon';
import { SegmentedGroup, segmentBase } from '../ui/SegmentedGroup';
import { switchToChat, switchToTerminal } from './chatActions';
import type { TaskSurface } from '../../chat/preferences';

const OPTIONS: TaskSurface[] = ['chat', 'terminal'];

/**
 * Which view a card's conversation is in, floating over that view. Only a card
 * that is or has been a chat has one. The highlight slides to the choice as
 * soon as it is made and breathes until that view has come up; a switch
 * mid-turn says so, since it waits for the turn to end.
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
  const chatComingUp = useChatStore((s) => {
    const session = s.sessions[ptyId];
    return !session || (session.info.status === 'starting' && session.nodes.length === 0);
  });
  const terminalComingUp = useTerminalStore((s) => s.displayStates[ptyId]?.blank ?? false);
  if (!chatAgent) return null;

  const shown = switching ?? surface;
  const pending = switching !== null || (surface === 'chat' ? chatComingUp : terminalComingUp);
  const waitingOnTurn = switching === 'terminal' ? chatBusy : switching === 'chat' ? terminalBusy : false;
  const choose = (next: TaskSurface) => {
    if (next === surface) return;
    void (next === 'terminal' ? switchToTerminal(ptyId) : switchToChat(ptyId));
  };

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
      {waitingOnTurn && (
        <span className="flex items-center gap-2 text-[12px] text-text-tertiary">
          Switching when this turn ends
          {switching === 'terminal' && (
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
      <div role="radiogroup" aria-label="View" data-pending={pending || undefined}>
        <SegmentedGroup placement="over">
          <div className="relative flex h-full">
            <div
              aria-hidden
              className={`surface-toggle-thumb absolute inset-y-0 left-0 w-1/2 bg-background-tertiary ${
                pending ? 'surface-toggle-thumb--pending' : ''
              }`}
              style={{ transform: `translateX(${OPTIONS.indexOf(shown) * 100}%)` }}
            />
            {OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={shown === option}
                aria-label={option === 'chat' ? 'Chat' : 'Terminal'}
                className={`${segmentBase} relative w-9 justify-center bg-transparent ${
                  shown === option ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => choose(option)}
              >
                <Icon name={option === 'chat' ? 'chat-circle' : 'terminal'} className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </SegmentedGroup>
      </div>
    </div>
  );
}
