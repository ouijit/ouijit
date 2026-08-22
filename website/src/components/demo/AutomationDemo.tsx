import { useState } from 'react';
import { useInView, useLoop } from './choreo';

const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];

type RowStatus = 'idle' | 'running' | 'done' | 'live';

interface HookConfig {
  key: string;
  label: string;
  description: string;
  command: string;
}

const HOOKS: HookConfig[] = [
  { key: 'start', label: 'Start', description: 'Task moves from To Do to In Progress', command: 'claude "$OUIJIT_TASK_DESCRIPTION"' },
  { key: 'continue', label: 'Continue', description: 'Reopening a task already In Progress', command: 'claude --continue' },
  { key: 'run', label: 'Run', description: 'The Run button or a runner panel opens', command: 'npm run dev' },
  { key: 'review', label: 'Review', description: 'Task moves to In Review', command: 'gh pr create --fill' },
  { key: 'done', label: 'Done', description: 'Task moves to Done', command: 'git push origin HEAD' },
];

const IDLE: Record<string, RowStatus> = Object.fromEntries(HOOKS.map((h) => [h.key, 'idle']));

/**
 * The five lifecycle hooks firing as a task crosses the board: the chip
 * rides the rail, and each matching hook runs as the card enters its column.
 */
export default function AutomationDemo() {
  const [sceneRef, inView] = useInView<HTMLDivElement>(0.4);
  const [stop, setStop] = useState(0);
  const [rows, setRows] = useState<Record<string, RowStatus>>(IDLE);

  const set = (key: string, status: RowStatus) => setRows((prev) => ({ ...prev, [key]: status }));

  useLoop(inView, (at) => {
    setStop(0);
    setRows(IDLE);

    at(1000, () => {
      setStop(1);
      set('start', 'running');
    });
    at(2300, () => {
      set('start', 'done');
      set('run', 'running');
    });
    at(3400, () => set('run', 'live'));
    at(4800, () => {
      setStop(2);
      set('review', 'running');
    });
    at(6100, () => set('review', 'done'));
    at(7200, () => {
      setStop(3);
      set('done', 'running');
    });
    at(8400, () => set('done', 'done'));
    return 10400;
  });

  return (
    <div ref={sceneRef} className="demo-frame hook-demo">
      <div className="hook-demo-rail">
        {STATUSES.map((label, i) => (
          <span key={label} className="hook-demo-stop" data-active={i === stop || undefined}>
            {label}
          </span>
        ))}
        <div className="hook-demo-chip" style={{ '--stop': stop } as React.CSSProperties}>
          <span className="hook-demo-chip-pill">
            <span className="hook-demo-chip-number">T-121</span> Wire payment retries
          </span>
        </div>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {HOOKS.map((hook) => (
          <div key={hook.key} className="hook-demo-row" data-state={rows[hook.key]}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">{hook.label}</span>
                <span className="text-[11px] text-text-tertiary">{hook.description}</span>
              </div>
              <div className="font-mono text-[11px] text-text-secondary mt-0.5 truncate">{hook.command}</div>
            </div>
            <span className="hook-demo-state shrink-0">
              {rows[hook.key] === 'running' && (
                <span
                  className="block w-3 h-3 rounded-full bg-transparent border-[1.5px] border-white/30 border-t-white/80"
                  style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
                />
              )}
              {rows[hook.key] === 'done' && <span className="text-[#4ee82e] text-[12px] leading-none">✓</span>}
              {rows[hook.key] === 'live' && (
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-white/55">
                  <span
                    className="block w-[6px] h-[6px] rounded-full bg-[#4ee82e]"
                    style={{ animation: 'terminal-status-pulse 1.6s ease-in-out infinite' }}
                  />
                  live
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
