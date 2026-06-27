import './tailwind.css';
import '@xterm/xterm/css/xterm.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StandaloneTerminalApp } from './components/StandaloneTerminalApp';
import { initIcons } from './utils/icons';
import { useAppStore } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';

initIcons();

// Expose stores for e2e tests
(window as any).__appStore = useAppStore;
(window as any).__projectStore = useProjectStore;

// The standalone terminal window loads this same bundle with `?mode=standalone`
// and mounts a minimal terminal-only view instead of the full app.
const isStandalone = new URLSearchParams(window.location.search).get('mode') === 'standalone';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(isStandalone ? <StandaloneTerminalApp /> : <App />);
}
