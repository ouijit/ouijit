import { TerminalHeaderView, TerminalHeaderName } from '@app/components/terminal/TerminalHeaderView';

interface State {
  summaryType: 'thinking' | 'ready';
  sandboxed?: boolean;
  label: string;
  summary?: string;
}

const STATES: State[] = [
  { summaryType: 'ready', label: 'shell', summary: 'idle' },
  { summaryType: 'thinking', label: 'claude', summary: 'thinking...' },
  { summaryType: 'ready', label: 'claude', summary: 'awaiting input' },
  { summaryType: 'ready', label: 'claude', summary: 'Edit Stepper.tsx' },
  { summaryType: 'ready', label: 'claude', summary: 'Bash npm test' },
  { summaryType: 'ready', label: 'claude', summary: 'done · 14 passed' },
  { summaryType: 'thinking', sandboxed: true, label: 'claude (sandbox)', summary: 'editing files' },
];

export default function AgentStatesDemo() {
  return (
    <div className="demo-frame">
      <div className="divide-y divide-white/[0.06]">
        {STATES.map((s, i) => (
          <TerminalHeaderView
            key={i}
            summaryType={s.summaryType}
            sandboxed={s.sandboxed}
            nameContent={<TerminalHeaderName label={s.label} summary={s.summary} />}
          />
        ))}
      </div>
    </div>
  );
}
