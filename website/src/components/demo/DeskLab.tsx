import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { BranchLabel, ClaudeBody } from './stackParts';

/** One fixed card so every desk background is judged against the same
 * foreground. */
export function SampleCard() {
  return (
    <div className="relative" style={{ height: 400, zIndex: 1 }}>
      <TerminalCardView isActive>
        <TerminalHeaderView
          summaryType="thinking"
          isActive
          nameContent={<TerminalHeaderName label="claude" lastOscTitle="Editing onboarding stepper..." />}
          branchContent={<BranchLabel branch="rework-onboarding" />}
        />
        <ClaudeBody />
      </TerminalCardView>
    </div>
  );
}
