import { useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';

interface ConnectRowProps {
  projectPath: string;
  availability: LinearAvailability;
}

/**
 * What this project's Linear issues are, asked once and never in a modal —
 * someone who opened the panel to read a pull request is not made to configure
 * a tracker first. Pre-filled with the `repo` label matching the git remote
 * where the workspace has one, and a team picker where it does not.
 */
export function ConnectRow({ projectPath, availability }: ConnectRowProps) {
  const suggested = availability.suggestedLabel;
  const [teamId, setTeamId] = useState(availability.teams[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const scope = (): LinearScope | null => {
    if (suggested) return { kind: 'repo-label', labelId: suggested.id, name: suggested.name };
    const team = availability.teams.find((t) => t.id === teamId);
    return team ? { kind: 'team', teamId: team.id, name: team.name } : null;
  };

  const connect = async () => {
    const chosen = scope();
    if (!chosen) return;
    setBusy(true);
    try {
      await useLinearStore.getState().connect(projectPath, chosen);
    } finally {
      setBusy(false);
    }
  };

  if (!suggested && availability.teams.length === 0) {
    return (
      <p className="px-4 py-3 text-[13px] text-text-tertiary">
        This Linear API key can see no teams. One limited to a team you are not on will do that.
      </p>
    );
  }

  return (
    <div className="px-4 py-3 flex items-center gap-2 border-b border-ink/[0.06]">
      <span className="text-[13px] text-text-secondary shrink-0">Linear issues from</span>
      {suggested ? (
        <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-text-primary">{suggested.name}</span>
      ) : (
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="field flex-1 min-w-0 h-8 text-[13px]"
        >
          {availability.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.key} · {team.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn-primary btn-compact shrink-0" disabled={busy} onClick={() => void connect()}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  );
}
