import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
  TerminalHeaderTags,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { useInView, prefersReducedMotion } from './choreo';

/* ─── Terminal bodies ─────────────────────────────────────────────── */

const BODY_CLS = 'flex-1 p-4 font-mono text-[11px] leading-[1.7] text-white/85 overflow-hidden min-h-0';

function ClaudeBody() {
  return (
    <div className="flex-1 grid grid-cols-2 max-sm:grid-cols-1 min-h-0">
      <div className={`${BODY_CLS} border-r border-white/[0.06] max-sm:border-r-0`}>
        <div className="text-white/70">
          <span className="text-white/35 mr-2">&gt;</span>
          Split onboarding into a three-step stepper with saved progress.
        </div>
        <div className="mt-2">
          <span className="text-[#7ee787] mr-1.5">⏺</span>Edit<span className="text-white/45">(</span>
          src/onboarding/Stepper.tsx<span className="text-white/45">)</span>
        </div>
        <div className="pl-4 text-white/55">
          <span className="text-white/30 mr-1.5">⎿</span>
          <span className="text-[#3fb950]">+124</span>
          <span className="mx-1 text-white/30">/</span>
          <span className="text-[#f85149]">−14</span>
          <span className="ml-2">lines · persists progress</span>
        </div>
        <div className="mt-2">
          <span className="text-[#7ee787] mr-1.5">⏺</span>Bash<span className="text-white/45">(</span>
          npm test onboarding<span className="text-white/45">)</span>
        </div>
        <div className="pl-4 text-white/55">
          <span className="text-white/30 mr-1.5">⎿</span>
          <span className="text-[#3fb950]">14 passed</span>, 0 failed
        </div>
        <div className="mt-2 text-white/40">
          · Thinking…<span className="terminal-cursor terminal-cursor--dim" />
        </div>
      </div>
      <div className="p-4 bg-background-secondary text-white text-xs max-sm:hidden overflow-hidden">
        <div className="text-sm font-semibold mb-2">Rework onboarding flow</div>
        <div className="text-[11px] font-semibold mb-1 mt-3">Outcome</div>
        <p className="text-white/55 text-[11px] leading-relaxed">
          Three step stepper that persists progress per user. Pick up where you left off.
        </p>
        <div className="text-[11px] font-semibold mb-1 mt-3">Steps</div>
        <ol className="pl-4 text-white/55 text-[11px] leading-relaxed list-decimal">
          <li>Extract each section into its own screen.</li>
          <li>
            Persist progress under <code className="bg-white/10 px-1.5 rounded text-[10px]">onboarding:userId</code>.
          </li>
          <li>
            Header level <code className="bg-white/10 px-1.5 rounded text-[10px]">{'<Stepper />'}</code> with back/next.
          </li>
        </ol>
      </div>
    </div>
  );
}

function DevServerBody() {
  const Hmr = ({ time, path }: { time: string; path: string }) => (
    <div>
      <span className="text-white/30">{time}</span> <span className="text-[#79b8ff]/80">[vite]</span>{' '}
      <span className="text-[#a4d4ff]/85">hmr update</span> <span className="text-white/55">{path}</span>
    </div>
  );
  return (
    <div className={BODY_CLS}>
      <div>
        <span className="text-[#a78bfa] font-semibold">VITE</span> <span className="text-white/45">v5.4.10</span>
        <span className="ml-3 text-white/35">ready in 412 ms</span>
      </div>
      <div className="mt-2">
        <span className="text-[#3fb950] mr-1.5">➜</span>
        <span className="text-white/85 mr-1">Local:</span>
        <span className="text-[#79b8ff]">http://localhost:5173/</span>
      </div>
      <div className="mt-3" />
      <Hmr time="14:32:18" path="/src/onboarding/Stepper.tsx" />
      <Hmr time="14:32:21" path="/src/onboarding/WelcomeIntro.tsx" />
      <div>
        <span className="text-white/30">14:32:34</span> <span className="text-[#79b8ff]/80">[vite]</span>{' '}
        <span className="text-[#ffb454]/90">page reload</span>{' '}
        <span className="text-white/45">useOnboardingProgress.ts (new file)</span>
      </div>
      <Hmr time="14:32:41" path="/src/onboarding/Stepper.tsx" />
      <div className="mt-2">
        <span className="terminal-cursor terminal-cursor--dim" />
      </div>
    </div>
  );
}

function TestBody() {
  return (
    <div className={BODY_CLS}>
      <div>
        <span className="text-white/45">$</span> npm test onboarding
      </div>
      <div className="mt-2">
        <span className="text-[#3fb950]">✓</span> <span className="text-white/70">stepper.test.tsx</span>
        <span className="text-white/40 ml-2">(6)</span>
      </div>
      <div>
        <span className="text-[#3fb950]">✓</span> <span className="text-white/70">progress.test.tsx</span>
        <span className="text-white/40 ml-2">(5)</span>
      </div>
      <div>
        <span className="text-[#3fb950]">✓</span> <span className="text-white/70">welcome-intro.test.tsx</span>
        <span className="text-white/40 ml-2">(3)</span>
      </div>
      <div className="mt-2 text-white/55">
        Test Files <span className="text-[#3fb950]">3 passed</span> <span className="text-white/35">(3)</span>
      </div>
      <div className="text-white/55">
        {'     '}Tests <span className="text-[#3fb950]">14 passed</span> <span className="text-white/35">(14)</span>
      </div>
      <div className="mt-2">
        <span className="text-white/45">$</span>
        <span className="terminal-cursor" />
      </div>
    </div>
  );
}

/* ─── Stack ───────────────────────────────────────────────────────── */

interface CardConfig {
  id: string;
  label: string;
  osc: string;
  summaryType: 'thinking' | 'ready';
  tags?: string[];
  actions?: ReactNode;
  body: ReactNode;
}

const CARDS: CardConfig[] = [
  {
    id: 'claude',
    label: 'claude',
    osc: 'Editing onboarding stepper…',
    summaryType: 'thinking',
    tags: ['onboarding', 'stepper'],
    actions: (
      <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
        <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-accent text-white">
          Plan
        </button>
        <div aria-hidden className="w-px h-3 bg-white/10 self-center" />
        <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-transparent text-text-secondary">
          Run
        </button>
      </div>
    ),
    body: <ClaudeBody />,
  },
  { id: 'dev', label: 'npm run dev', osc: 'live dev server', summaryType: 'ready', body: <DevServerBody /> },
  { id: 'test', label: 'npm test', osc: '14 passed', summaryType: 'ready', body: <TestBody /> },
];

/**
 * The card stack, cycling: every few seconds the next terminal comes to the
 * front, exactly as ⌘1/⌘2/⌘3 do in the app. Hover pauses; clicking a back
 * card promotes it.
 */
export default function StackDemo() {
  const [sceneRef, inView] = useInView<HTMLDivElement>(0.4);
  const [order, setOrder] = useState<string[]>(CARDS.map((c) => c.id));
  const hoveredRef = useRef(false);

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;
    const interval = window.setInterval(() => {
      if (hoveredRef.current) return;
      setOrder((prev) => [prev[prev.length - 1], ...prev.slice(0, -1)]);
    }, 4200);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <div
      ref={sceneRef}
      style={{ position: 'relative', height: 380, marginTop: 72 }}
      onMouseEnter={() => (hoveredRef.current = true)}
      onMouseLeave={() => (hoveredRef.current = false)}
    >
      {CARDS.map((card) => {
        const pos = order.indexOf(card.id);
        const isFront = pos === 0;
        return (
          <TerminalCardView
            key={card.id}
            isActive={isFront}
            backDepth={pos}
            onClick={isFront ? undefined : () => setOrder((prev) => [card.id, ...prev.filter((id) => id !== card.id)])}
          >
            <TerminalHeaderView
              summaryType={card.summaryType}
              isActive={isFront}
              isBackCard={!isFront}
              stackPosition={isFront ? undefined : pos}
              nameContent={<TerminalHeaderName label={card.label} summary={isFront ? undefined : card.osc} lastOscTitle={isFront ? card.osc : undefined} />}
              tagsContent={isFront && card.tags ? <TerminalHeaderTags tags={card.tags} /> : undefined}
              actions={isFront ? card.actions : undefined}
            />
            {card.body}
          </TerminalCardView>
        );
      })}
    </div>
  );
}
