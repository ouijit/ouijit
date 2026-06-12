import './tailwind.css';
import { init as initGhostty } from 'ghostty-web';
import { createRoot } from 'react-dom/client';
import log from 'electron-log/renderer';
import { App } from './App';
import { initIcons } from './utils/icons';
import { useAppStore } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';

const rendererLog = log.scope('renderer');

initIcons();

// Expose stores for e2e tests
(window as any).__appStore = useAppStore;
(window as any).__projectStore = useProjectStore;

// ghostty-web's WASM module must finish loading before any Terminal is
// constructed, so gate the first render on it. Terminals are only created
// after mount (user action or session restore), never at module scope.
const root = document.getElementById('root');
if (root) {
  initGhostty()
    .catch((error) => {
      rendererLog.error('ghostty wasm init failed', { error: error instanceof Error ? error.message : String(error) });
    })
    .then(() => {
      createRoot(root).render(<App />);
    });
}
