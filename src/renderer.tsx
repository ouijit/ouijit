import './tailwind.css';
import '@xterm/xterm/css/xterm.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initIcons } from './utils/icons';
import { initThemeSync, initTheme } from './theme/themeManager';
import { useAppStore } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';

// Apply the cached theme before first render (no dark flash for light-mode
// users), then reconcile with the persisted settings asynchronously.
initThemeSync();
void initTheme();

initIcons();

// Expose stores for e2e tests
(window as any).__appStore = useAppStore;
(window as any).__projectStore = useProjectStore;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
