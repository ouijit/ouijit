import './index.css';
import '@xterm/xterm/css/xterm.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initIcons } from './utils/icons';
import { useAppStore } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';

initIcons();

// Expose stores for e2e tests
(window as any).__appStore = useAppStore;
(window as any).__projectStore = useProjectStore;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
