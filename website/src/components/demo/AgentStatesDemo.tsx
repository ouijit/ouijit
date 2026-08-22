import { useState } from 'react';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { useInView, useLoop } from './choreo';

interface RowState {
  summaryType: 'thinking' | 'ready';
  summary: string;
}

interface RowConfig {
  key: string;
  label: string;
  sandboxed?: boolean;
  initial: RowState;
}

const ROWS: RowConfig[] = [
  { key: 'shell', label: 'shell', initial: { summaryType: 'ready', summary: 'idle' } },
  { key: 'hero', label: 'claude', initial: { summaryType: 'thinking', summary: 'thinking…' } },
  { key: 'codex', label: 'codex', initial: { summaryType: 'ready', summary: 'awaiting input' } },
  { key: 'pi', label: 'pi', initial: { summaryType: 'ready', summary: 'done · lint clean' } },
  { key: 'opencode', label: 'opencode', initial: { summaryType: 'thinking', summary: 'writing migrations…' } },
  { key: 'sandbox', label: 'claude (sandbox)', sandboxed: true, initial: { summaryType: 'thinking', summary: 'editing files' } },
];

const INITIAL: Record<string, RowState> = Object.fromEntries(ROWS.map((r) => [r.key, r.initial]));

/**
 * The status column, alive: one agent works through a turn while the others
 * idle, and the macOS banner fires the moment its turn ends.
 */
export default function AgentStatesDemo() {
  const [sceneRef, inView] = useInView<HTMLDivElement>(0.4);
  const [rows, setRows] = useState<Record<string, RowState>>(INITIAL);
  const [notif, setNotif] = useState(false);

  const set = (key: string, state: RowState) => setRows((prev) => ({ ...prev, [key]: state }));

  useLoop(inView, (at) => {
    setRows(INITIAL);
    setNotif(false);

    at(1300, () => set('hero', { summaryType: 'thinking', summary: 'Edit src/onboarding/Stepper.tsx' }));
    at(3100, () => set('hero', { summaryType: 'thinking', summary: 'Bash npm test onboarding' }));
    at(5100, () => {
      set('hero', { summaryType: 'ready', summary: 'done · 14 passed' });
      setNotif(true);
    });
    at(5900, () => set('opencode', { summaryType: 'ready', summary: 'done · 3 files changed' }));
    at(7600, () => set('codex', { summaryType: 'thinking', summary: 'reviewing diff…' }));
    at(9200, () => setNotif(false));
    return 10600;
  });

  return (
    <div ref={sceneRef} className="agent-states-demo">
      <div className="demo-frame">
        <div className="divide-y divide-white/[0.06]">
          {ROWS.map((row) => (
            <TerminalHeaderView
              key={row.key}
              summaryType={rows[row.key].summaryType}
              sandboxed={row.sandboxed}
              nameContent={<TerminalHeaderName label={row.label} summary={rows[row.key].summary} />}
            />
          ))}
        </div>
      </div>
      <div className="agent-states-notif" data-visible={notif || undefined} aria-hidden="true">
        <div className="macos-notif">
          <img src="/assets/ouijit-app-icon.png" alt="" width={36} height={36} style={{ flexShrink: 0, display: 'block' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.95)', letterSpacing: 0.1 }}>
                Ouijit
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>now</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2, lineHeight: 1.3 }}>
              Rework onboarding flow — done · 14 passed
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
