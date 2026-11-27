import { useEffect } from 'react';
import { Icon } from './terminal/Icon';
import { Tooltip } from './ui/Tooltip';
import { goTo } from './navigation';
import { nextPlace, placeName, useNavigationHistory } from '../stores/navigationHistory';
import { useTerminalStore } from '../stores/terminalStore';
import { useHomeChatStore } from '../stores/homeChatStore';
import { useAppStore } from '../stores/appStore';

const isMac = navigator.platform.toLowerCase().includes('mac');
const MOD = isMac ? '⌘' : 'Ctrl+';
/** The mouse's side buttons, as Chromium numbers them. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

const ARROW =
  'w-8 h-9 flex items-center justify-center rounded-[10px] transition-colors duration-150 [-webkit-app-region:no-drag] [&>svg]:w-[18px] [&>svg]:h-[18px] enabled:text-text-secondary enabled:hover:bg-background-secondary enabled:hover:text-text-primary disabled:text-text-tertiary disabled:opacity-50';

const ARROWS = {
  back: { verb: 'Back', icon: 'caret-left', key: '[' },
  forward: { verb: 'Forward', icon: 'caret-right', key: ']' },
} as const;

/** Back and Forward, always there, greyed while there is nowhere to go, each naming where it goes. */
export function HistoryArrows() {
  const history = useNavigationHistory();
  // Whether a place is still there reads these, so a terminal closing greys an arrow or moves it on.
  useTerminalStore((s) => s.displayStates);
  useHomeChatStore((s) => s.chats);
  useAppStore((s) => s.projects);
  return (
    <div className="flex items-center shrink-0">
      {(['back', 'forward'] as const).map((direction) => {
        const { verb, icon, key } = ARROWS[direction];
        const place = nextPlace(direction, history);
        const label = place ? `${verb} to ${placeName(place)}` : verb;
        return (
          <Tooltip
            key={direction}
            text={
              <>
                {label} <kbd className="ml-1 font-sans opacity-60">{`${MOD}${key}`}</kbd>
              </>
            }
            placement="bottom-start"
          >
            <button
              type="button"
              className={ARROW}
              aria-label={label}
              disabled={!place}
              onClick={() => void goTo(direction)}
            >
              <Icon name={icon} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** ⌘[ and ⌘], the mouse's side buttons, and the swipes and app commands main forwards. */
export function useHistoryShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return;
      const direction = e.key === '[' ? 'back' : e.key === ']' ? 'forward' : null;
      if (!direction) return;
      e.preventDefault();
      e.stopPropagation();
      void goTo(direction);
    };
    const onMouse = (e: MouseEvent) => {
      const direction = e.button === MOUSE_BACK ? 'back' : e.button === MOUSE_FORWARD ? 'forward' : null;
      if (!direction) return;
      e.preventDefault();
      void goTo(direction);
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onMouse);
    const offMain = window.api.onNavigate((direction) => void goTo(direction));
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onMouse);
      offMain();
    };
  }, []);
}
