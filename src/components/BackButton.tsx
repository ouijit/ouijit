import { useEffect } from 'react';
import { Icon } from './terminal/Icon';
import { Tooltip } from './ui/Tooltip';
import { goBack } from './navigation';
import { placeName, previousPlace, useNavigationHistory } from '../stores/navigationHistory';
import { useTerminalStore } from '../stores/terminalStore';
import { useHomeChatStore } from '../stores/homeChatStore';
import { useAppStore } from '../stores/appStore';

const isMac = navigator.platform.toLowerCase().includes('mac');
/** The mouse's back button, as Chromium numbers it. */
const MOUSE_BACK = 3;

/** Shown only while there is somewhere to go back to, named in its tooltip. */
export function BackButton({ className }: { className: string }) {
  const back = useNavigationHistory((s) => s.back);
  // Whether a place is still there reads these, so a terminal closing hides Back or moves it on.
  useTerminalStore((s) => s.displayStates);
  useHomeChatStore((s) => s.chats);
  useAppStore((s) => s.projects);
  const place = previousPlace(back);
  if (!place) return null;
  const label = `Back to ${placeName(place)}`;
  return (
    <Tooltip
      text={
        <>
          {label} <kbd className="ml-1 font-sans opacity-60">{isMac ? '⌘[' : 'Ctrl+['}</kbd>
        </>
      }
      placement="bottom-start"
    >
      <button type="button" className={className} aria-label={label} onClick={() => void goBack()}>
        <Icon name="caret-left" />
      </button>
    </Tooltip>
  );
}

/** ⌘[, the mouse's back button, and the swipe or app command main forwards, all go back. */
export function useBackShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || !(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      void goBack();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button !== MOUSE_BACK) return;
      e.preventDefault();
      void goBack();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onMouse);
    const offSwipe = window.api.onNavigateBack(() => void goBack());
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onMouse);
      offSwipe();
    };
  }, []);
}
