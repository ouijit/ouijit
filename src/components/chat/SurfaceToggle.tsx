import { useTerminalStore } from '../../stores/terminalStore';
import { Icon } from '../terminal/Icon';
import { switchToChat, switchToTerminal } from './chatActions';
import type { TaskSurface } from '../../chat/preferences';

/**
 * Which view a card's conversation is in, floating over that view. Only a card
 * that is or has been a chat has one. A switch mid-turn waits for the turn to end.
 */
export function SurfaceToggle({ ptyId }: { ptyId: string }) {
  const surface = useTerminalStore((s) => s.displayStates[ptyId]?.surface ?? 'terminal');
  const chatAgent = useTerminalStore((s) => s.displayStates[ptyId]?.chatAgent ?? null);
  const switching = useTerminalStore((s) => s.displayStates[ptyId]?.switching ?? null);
  if (!chatAgent) return null;

  const choose = (next: TaskSurface) => {
    if (next === surface) return;
    void (next === 'terminal' ? switchToTerminal(ptyId) : switchToChat(ptyId));
  };

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
      {switching && (
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
      <div role="radiogroup" aria-label="View" className="flex items-center gap-0.5 p-0.5 rounded-[9px] bg-ink/[0.05]">
        {(['chat', 'terminal'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={surface === option}
            aria-label={option === 'chat' ? 'Chat' : 'Terminal'}
            disabled={switching !== null}
            className={`w-6 h-6 flex items-center justify-center rounded-[7px] transition-colors duration-150 disabled:opacity-40 ${
              surface === option
                ? 'bg-terminal-bg text-text-primary shadow-[0_0_0_1px_var(--color-separator)]'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
            onClick={() => choose(option)}
          >
            <Icon name={option === 'chat' ? 'chat-circle' : 'terminal'} className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
