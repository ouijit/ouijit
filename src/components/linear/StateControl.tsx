import { useState } from 'react';
import type { LinearIssueDetail } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';
import { useProjectStore } from '../../stores/projectStore';
import { ActionMenu } from '../ui/ActionMenu';
import { MenuItem } from '../ui/Menu';
import { SegmentedGroup } from '../ui/SegmentedGroup';

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
      // The groups are membership in a workflow state, so moving one moves the
      // row between them — the list is as stale as the issue was.
      const store = useLinearStore.getState();
      await Promise.all([store.reloadIssue(projectPath), store.loadIssues(projectPath)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SegmentedGroup>
      <ActionMenu
        label={busy ? 'Moving…' : issue.state.name}
        // Linear's own colour for the state, which is how it reads there.
        dot
        dotColor={issue.state.color}
        disabled={busy}
        title={`${issue.identifier} is ${issue.state.name}`}
      >
        {(close) =>
          issue.workflowStates.map((state) => (
            <MenuItem
              key={state.id}
              label={state.name}
              selected={state.id === issue.state.id}
              onClick={() => {
                close();
                void move(state.id);
              }}
            />
          ))
        }
      </ActionMenu>
    </SegmentedGroup>
  );
}
