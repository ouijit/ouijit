import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
  TerminalHeaderTags,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';

/**
 * Composed stack of terminal cards demonstrating the active card + back cards.
 * Mirrors the app's TerminalCardStack layout: a single relative container with
 * each TerminalCardView as `position: absolute inset-0`, where back cards
 * translate themselves upward via the depthBase styles.
 */
export default function StackDemo() {
  // Reserve top space for back cards (3 cards × 24px lift) + active height.
  return (
    <div style={{ position: 'relative', height: 540, paddingTop: 96 }}>
      {/* Back card 3 */}
      <TerminalCardView backDepth={3}>
        <TerminalHeaderView
          summaryType="ready"
          stackPosition={3}
          isBackCard
          nameContent={<TerminalHeaderName label="npm run dev" summary="live dev server" />}
        />
      </TerminalCardView>
      {/* Back card 2 */}
      <TerminalCardView backDepth={2}>
        <TerminalHeaderView
          summaryType="ready"
          stackPosition={2}
          isBackCard
          nameContent={<TerminalHeaderName label="npm test" summary="14 passed" />}
        />
      </TerminalCardView>
      {/* Back card 1 */}
      <TerminalCardView backDepth={1}>
        <TerminalHeaderView
          summaryType="thinking"
          stackPosition={1}
          isBackCard
          nameContent={<TerminalHeaderName label="claude" summary="Aligning hover states" />}
        />
      </TerminalCardView>
      {/* Front (active) card */}
      <TerminalCardView isActive>
        <TerminalHeaderView
          summaryType="thinking"
          isActive
          nameContent={<TerminalHeaderName label="claude" summary="Editing onboarding stepper..." />}
          tagsContent={<TerminalHeaderTags tags={['onboarding', 'stepper']} />}
          actions={
            <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
              <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-accent text-white">
                Plan
              </button>
              <div aria-hidden className="w-px h-3 bg-white/10 self-center" />
              <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-transparent text-text-secondary">
                Run
              </button>
            </div>
          }
        />
        <div className="flex-1 grid grid-cols-2 min-h-0">
          <div className="p-4 font-mono text-[11px] leading-6 text-white/85 border-r border-white/[0.06] overflow-hidden">
            <div>
              <span className="text-white/40 mr-1">{'>'}</span> Split onboarding into a three-step stepper with saved
              progress.
            </div>
            <div className="mt-1.5 text-white">
              <span className="bg-accent/15 text-[#79b8ff] px-1.5 rounded mr-1">Edit</span>
              src/onboarding/Stepper.tsx
            </div>
            <div className="text-white/55 pl-3">└─ +124 lines, persists progress, adds back affordance</div>
            <div className="mt-1.5 text-white">
              <span className="bg-accent/15 text-[#79b8ff] px-1.5 rounded mr-1">Bash</span>
              npm test onboarding
            </div>
            <div className="text-white/55 pl-3">
              └─ <span className="text-[#4ee82e]">14 passed</span>, 0 failed
            </div>
            <div className="mt-2 text-white/40">· Thinking...</div>
          </div>
          <div className="p-4 bg-background-secondary text-white text-xs">
            <div className="text-sm font-semibold mb-2">Rework onboarding flow</div>
            <div className="text-[11px] font-semibold mb-1 mt-3">Outcome</div>
            <p className="text-white/55 text-[11px] leading-relaxed">
              Three step stepper that persists progress per user. Pick up where you left off.
            </p>
            <div className="text-[11px] font-semibold mb-1 mt-3">Steps</div>
            <ol className="pl-4 text-white/55 text-[11px] leading-relaxed list-decimal">
              <li>Extract each section into its own screen.</li>
              <li>
                Persist progress under{' '}
                <code className="bg-white/10 px-1.5 rounded text-[10px]">onboarding:userId</code>.
              </li>
              <li>
                Header level <code className="bg-white/10 px-1.5 rounded text-[10px]">{'<Stepper />'}</code> with
                back/next.
              </li>
              <li>
                Reusable <code className="bg-white/10 px-1.5 rounded text-[10px]">{'<WelcomeIntro />'}</code>.
              </li>
            </ol>
          </div>
        </div>
      </TerminalCardView>
    </div>
  );
}
