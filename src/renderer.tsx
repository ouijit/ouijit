import './index.css';
import '@xterm/xterm/css/xterm.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
