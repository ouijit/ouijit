import { useEffect } from 'react';
import { useIPCListeners } from './hooks/useIPCListeners';

export function App() {
  useIPCListeners();

  useEffect(() => {
    document.body.classList.add(
      navigator.platform.toLowerCase().includes('mac') ? 'platform-darwin' : 'platform-other',
    );
  }, []);

  return (
    <div className="app-layout">
      <div className="app-main">
        <header className="header">
          <div className="header-content" />
        </header>
        <main className="main-content">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>React renderer active</span>
          </div>
        </main>
      </div>
    </div>
  );
}
