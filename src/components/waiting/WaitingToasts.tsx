import { askVerb } from '../../types';
import { useShallow } from 'zustand/react/shallow';
import { toasted, useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { focusTerminal } from '../navigation';
import { isHomeChat } from '../../stores/homeChatStore';
import { openHomeChat } from '../chat/homeChatActions';
import { useOwnerOf } from '../chat/HomeChatDecisions';
import { Icon } from '../terminal/Icon';
import { HOOK_VERB, runWaiting, useAsker, useMovesOwnTask, useTaskName } from './WaitingDialog';

/**
 * What agents left on terminals the user has no card open for, until it is
 * answered or its toast is closed. A worker's ask also shows in the Chat
 * conversation that owns its task, so it is not toasted while that is on screen.
 */
export function WaitingToasts() {
  const items = useWaitingStore(useShallow((s) => toasted(s.items, s.shownOn)));
  const shownOn = useWaitingStore((s) => s.shownOn);
  const ownerOf = useOwnerOf();
  return items
    .filter((item) => {
      const owner = ownerOf(item);
      return !(owner && owner in shownOn);
    })
    .map((item) => <WaitingToast key={item.id} item={item} />);
}

const pill =
  'shrink-0 px-2.5 py-1 text-xs font-medium rounded-full transition-colors duration-150 [-webkit-app-region:no-drag]';

function WaitingToast({ item }: { item: Waiting }) {
  const asker = useAsker(item.from);
  const taskName = useTaskName(item);
  const ownTask = useMovesOwnTask(item);
  const { remove, hideToast } = useWaitingStore.getState();
  // A script is read before it runs, which takes the full dialog on its card.
  const runsHere = item.kind === 'move' || !item.ask.file;

  return (
    <div
      role="status"
      className="glass-bevel animate-toast-in pointer-events-auto relative flex flex-col gap-2 w-[360px] max-w-[90vw] py-2.5 pl-3 pr-2.5 rounded-[14px] border border-bezel text-sm text-text-primary"
      style={{
        background: 'var(--color-surface)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: 'var(--shadow-toast)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-status-unread shrink-0" />
        <span className="flex-1 min-w-0 truncate font-semibold">
          {item.kind === 'ask' ? asker.name : `${HOOK_VERB[item.hookType] ?? 'Move'} ${taskName}`}
        </span>
        {item.kind === 'ask' && asker.number && (
          <span className="shrink-0 font-mono text-xs text-text-tertiary">{asker.number}</span>
        )}
        <button
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-text-tertiary hover:text-text-secondary hover:bg-ink/[0.06] transition-colors duration-150 [-webkit-app-region:no-drag]"
          onClick={() => hideToast(item.id)}
          aria-label="Close"
        >
          <Icon name="x" className="w-3 h-3" />
        </button>
      </div>
      <div className="pl-3.5 truncate text-xs text-text-secondary">
        {item.kind === 'ask' ? (
          <span className="font-mono">{item.ask.command}</span>
        ) : ownTask ? (
          item.hookName || 'Hook'
        ) : (
          `${item.hookName || 'Hook'}, from ${asker.name}`
        )}
      </div>
      <div className="pl-3.5 flex items-center gap-1.5">
        {runsHere && (
          <button
            className={`${pill} bg-accent text-accent-ink hover:bg-accent-hover`}
            onClick={() => runWaiting(item)}
          >
            {item.kind === 'ask' ? askVerb(item.ask) : 'Run'}
          </button>
        )}
        {item.kind === 'move' && (
          <button className={`${pill} bg-ink/[0.08] hover:bg-ink/[0.12]`} onClick={() => remove(item.id)}>
            Skip
          </button>
        )}
        <button
          className={`${pill} bg-ink/[0.08] hover:bg-ink/[0.12]`}
          onClick={() => void (isHomeChat(item.from) ? openHomeChat(item.from) : focusTerminal(item.from))}
        >
          Go to
        </button>
      </div>
    </div>
  );
}
