import { useTerminalStore } from '../stores/terminalStore';

const HOME_PROJECT_PATH = '__home__';
const EMPTY: string[] = [];

export function HomeView() {
  const terminals = useTerminalStore((s) => s.terminalsByProject[HOME_PROJECT_PATH] ?? EMPTY);

  // TODO: Reconnect orphaned home sessions on mount
  // For now, home view shows a simple sessions placeholder
  // Full home view terminal support will be wired in a follow-up

  if (terminals.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
          fontSize: '14px',
        }}
      >
        Sessions
      </div>
    );
  }

  // When home terminals exist, render them as a card stack
  // (This will be used when session preservation is fully wired)
  return (
    <div className="home-view">
      {/* Future: TerminalCardStack for home view sessions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
          fontSize: '14px',
        }}
      >
        Sessions ({terminals.length})
      </div>
    </div>
  );
}
