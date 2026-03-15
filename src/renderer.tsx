import './index.css';
import '@xterm/xterm/css/xterm.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initIcons } from './utils/icons';

initIcons();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
