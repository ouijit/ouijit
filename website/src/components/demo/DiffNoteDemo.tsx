import { useState, type ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { useInView, useLoop } from './choreo';

const NOTE_TEXT = 'does this survive sign-out? add a test';

interface Line {
  type: 'context' | 'addition' | 'deletion';
  oldNo?: number;
  newNo?: number;
  content: ReactNode;
  /** The note composer anchors under this line. */
  noteTarget?: boolean;
}

const hl = (text: string, kind: 'add' | 'del') => (
  <span className={kind === 'add' ? 'rounded-[3px] bg-[rgba(63,185,80,0.28)] px-[2px]' : 'rounded-[3px] bg-[rgba(248,81,73,0.25)] px-[2px]'}>
    {text}
  </span>
);

const LINES: Line[] = [
  { type: 'context', oldNo: 4, newNo: 4, content: 'export function Stepper({ accountId }: Props) {' },
  {
    type: 'deletion',
    oldNo: 5,
    content: <>{'  const [step, setStep] = '}{hl('useState(0)', 'del')};</>,
  },
  {
    type: 'addition',
    newNo: 5,
    content: <>{'  const [step, setStep] = '}{hl('usePersistedStep(accountId)', 'add')};</>,
    noteTarget: true,
  },
  { type: 'context', oldNo: 6, newNo: 6, content: '  const steps = useMemo(() => buildSteps(), []);' },
  {
    type: 'addition',
    newNo: 7,
    content: <>{'  const goBack = () => setStep((s) => '}{hl('Math.max(0, s - 1)', 'add')});</>,
  },
  { type: 'context', oldNo: 7, newNo: 8, content: '  return (' },
  {
    type: 'addition',
    newNo: 9,
    content: <>{'    '}{hl('<StepHeader step={step} onBack={goBack} />', 'add')}</>,
  },
  { type: 'context', oldNo: 8, newNo: 10, content: '    <StepBody step={step} />' },
];

type Phase = 'idle' | 'composing' | 'sent';

/**
 * The diff surface, mid-review: word-level highlights, and a note typed on a
 * changed line that goes to the agent working in that worktree.
 */
export default function DiffNoteDemo() {
  const [sceneRef, inView] = useInView<HTMLDivElement>(0.4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState(0);
  const [sendFlash, setSendFlash] = useState(false);

  useLoop(inView, (at) => {
    setPhase('idle');
    setTyped(0);
    setSendFlash(false);

    at(900, () => setPhase('composing'));
    const TYPE_START = 1500;
    const TYPE_MS = 42;
    for (let i = 1; i <= NOTE_TEXT.length; i++) {
      at(TYPE_START + i * TYPE_MS, () => setTyped(i));
    }
    const doneTyping = TYPE_START + NOTE_TEXT.length * TYPE_MS;
    at(doneTyping + 450, () => setSendFlash(true));
    at(doneTyping + 700, () => setPhase('sent'));
    return doneTyping + 5400;
  });

  return (
    <div ref={sceneRef} className="demo-frame diff-demo">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <Icon name="git-branch" className="w-3.5 h-3.5 text-white/50 shrink-0" />
        <span className="text-[13px] text-white/70 font-mono truncate">rework-onboarding</span>
        <span className="text-[11px] text-white/40">1 file</span>
        <span className="text-[11px] font-mono text-[#3fb950]">+3</span>
        <span className="text-[11px] font-mono text-[#f85149]">-1</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#252525] border-b border-white/[0.06]">
        <span className="flex-1 min-w-0 truncate text-[12px] text-white/90 font-mono">src/onboarding/Stepper.tsx</span>
        <span className="shrink-0 text-[10px] px-1.5 py-px rounded font-medium bg-white/[0.06] text-white/55">
          modified
        </span>
      </div>
      <div className="py-0.5 pr-3 pl-[86px] bg-[rgba(88,86,214,0.10)] text-[#8b8bcd] font-mono text-[11px] truncate">
        @@ -4,5 +4,8 @@ export function Stepper
      </div>
      {LINES.map((line, i) => (
        <div key={i}>
          <DiffLineRow line={line} noted={line.noteTarget && phase === 'sent'} />
          {line.noteTarget && phase === 'composing' && (
            <div className="diff-demo-composer">
              <div className="diff-demo-composer-text">
                {NOTE_TEXT.slice(0, typed)}
                <span className="terminal-cursor" />
              </div>
              <div className="diff-demo-composer-foot">
                <span className="diff-demo-composer-hint">↵ to send</span>
                <span className={`diff-demo-composer-send${sendFlash ? ' is-flashing' : ''}`}>Send to agent</span>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="diff-demo-pickup" data-visible={phase === 'sent' || undefined}>
        <span
          className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
          style={{ background: '#da77f2', animation: 'terminal-status-pulse 1s ease-in-out infinite' }}
        />
        <span className="text-white/85">claude</span>
        <span className="text-white/45">— reading your note…</span>
      </div>
    </div>
  );
}

function DiffLineRow({ line, noted }: { line: Line; noted?: boolean }) {
  const lineBg =
    line.type === 'addition'
      ? 'bg-[rgba(63,185,80,0.10)]'
      : line.type === 'deletion'
        ? 'bg-[rgba(248,81,73,0.08)]'
        : '';
  const gutterBg =
    line.type === 'addition'
      ? 'bg-[rgba(63,185,80,0.12)]'
      : line.type === 'deletion'
        ? 'bg-[rgba(248,81,73,0.10)]'
        : 'bg-[#141414]';
  const prefix = line.type === 'context' ? ' ' : line.type === 'addition' ? '+' : '-';
  const prefixColor =
    line.type === 'addition' ? 'text-[#3fb950]' : line.type === 'deletion' ? 'text-[#f85149]' : 'text-transparent';
  return (
    <div className={`flex font-mono text-[11px] leading-5 ${lineBg}`}>
      <span className="flex shrink-0 select-none">
        <span className={`w-[36px] px-1.5 text-right text-white/25 ${gutterBg} border-r border-white/5`}>
          {line.oldNo ?? ''}
        </span>
        <span className={`w-[36px] px-1.5 text-right text-white/25 ${gutterBg} border-r border-white/5`}>
          {line.newNo ?? ''}
        </span>
      </span>
      <span className="flex-1 pl-2 pr-2 whitespace-pre-wrap break-words text-[#e6edf3] min-w-0">
        <span className={`inline-block w-3 select-none ${prefixColor}`}>{prefix}</span>
        {line.content}
        {noted && <span className="diff-demo-note-chip">✓ sent to claude</span>}
      </span>
    </div>
  );
}
