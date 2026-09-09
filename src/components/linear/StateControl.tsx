import { useState } from 'react';
import type { LinearIssueDetail } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';

interface StateControlProps {
  projectPath: string;
  issue: LinearIssueDetail;
}

/**
 * Moves the issue through its team's workflow.
 *
 * The escape hatch where Linear's GitHub integration is not watching the repo,
 * and the fastest path even where it is. It sits on the issue, where a person
 * is looking at it and pressing it; the kanban board drives nothing.
 *
 * A key without Write cannot read the team's states either, so under one the
 * control is absent rather than broken.
 */
export function StateControl({ projectPath, issue }: StateControlProps) {
  const [busy, setBusy] = useState(false);
  if (issue.workflowStates.length === 0) return null;

  const move = async (stateId: string) => {
    if (stateId === issue.state.id) return;
    setBusy(true);
    try {
      const result = await window.api.linear.moveIssue(projectPath, issue.id, stateId);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not move the issue', 'error');
        return;
      }
      await useLinearStore.getState().reloadIssue(projectPath);
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-ink/[0.08] transition-colors duration-150">
      <Icon name="circle-dashed" className="w-3.5 h-3.5 shrink-0" style={{ color: issue.state.color }} />
      <select
        value={issue.state.id}
        disabled={busy}
        aria-label="Workflow state"
        className="bg-transparent border-none outline-none text-[13px] text-text-secondary"
        onChange={(e) => void move(e.target.value)}
      >
        {issue.workflowStates.map((state) => (
          <option key={state.id} value={state.id}>
            {state.name}
          </option>
        ))}
      </select>
    </label>
  );
}
