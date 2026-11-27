import './tailwind.css';
import '@xterm/xterm/css/xterm.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initIcons } from './utils/icons';
import { initChat } from './components/chat/chatActions';
import { openTerminalLink } from './links/terminalLink';
import { initThemeSync, initTheme } from './theme/themeManager';
import { useAppStore } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';
import { trackWindowFocus, useTerminalStore } from './stores/terminalStore';
import { useWaitingStore } from './stores/waitingStore';
import { installNavigationHistory } from './stores/navigationHistory';
import { setTerminalLinkOpener } from './links/terminalLinkOpener';

// Apply the cached theme before first render (no dark flash for light-mode
// users), then reconcile with the persisted settings asynchronously.
initThemeSync();
void initTheme();

initIcons();
trackWindowFocus();
initChat();
installNavigationHistory();
setTerminalLinkOpener(openTerminalLink);

// Expose stores for e2e tests
(window as any).__appStore = useAppStore;
(window as any).__projectStore = useProjectStore;
(window as any).__terminalStore = useTerminalStore;
(window as any).__waitingStore = useWaitingStore;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
