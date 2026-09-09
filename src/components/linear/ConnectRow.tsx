import { useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';
import { Icon } from '../terminal/Icon';
import { MenuDivider, MenuItem, MenuPopover } from '../ui/Menu';

interface ConnectRowProps {
  projectPath: string;
  availability: LinearAvailability;
}

function scopeKey(scope: LinearScope): string {
  return scope.kind === 'repo-label' ? `label:${scope.labelId}` : `team:${scope.teamId}`;
}

/**
 * What this project's Linear issues are, asked once and never in a modal —
 * someone who opened the panel to read a pull request is not made to configure
 * a tracker first.
 *
 * The `repo` label matching the git remote is pre-selected where the workspace
 * labels that way; the picker holds it and the teams together, so the answer
 * can be changed without leaving the row that asked.
 */
export function ConnectRow({ projectPath, availability }: ConnectRowProps) {
  const [picked, setPicked] = useState<LinearScope | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const labels = availability.repoLabels;
  const teams = availability.teams;
  const suggested = availability.suggestedLabel;

  // Held as the scope rather than an id: what is offered arrives with a later
  // load, and an id chosen from an empty list would connect nothing.
  const chosen: LinearScope | null =
    picked ??
    (suggested
      ? { kind: 'repo-label', labelId: suggested.id, name: suggested.name }
      : teams[0]
        ? { kind: 'team', teamId: teams[0].id, name: teams[0].name }
        : null);

  const connect = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await useLinearStore.getState().connect(projectPath, chosen);
    } finally {
      setBusy(false);
    }
  };

  if (!chosen) {
    return (
      <p className="px-4 py-3 text-[13px] text-text-tertiary text-balance">
        This Linear API key can see no teams. One limited to a team you are not on will do that.
      </p>
    );
  }

  const pick = (scope: LinearScope) => {
    setPicked(scope);
    setOpen(false);
  };

  return (
    <div className="px-3 py-2.5 flex flex-col gap-1.5 border-b border-ink/[0.06]">
      <span className="px-1 text-[13px] text-text-tertiary">Linear issues from</span>
      <div className="flex items-center gap-2">
        <MenuPopover
          open={open}
          onOpenChange={setOpen}
          placement="bottom-start"
          className="w-[17rem] max-h-[22rem]"
          trigger={(ref) => (
            <button
              ref={ref}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              title={chosen.name}
              // The search field above it, one size down: the sidebar has one
              // control shape and this is it.
              className={`flex-1 min-w-0 flex items-center gap-2 h-8 px-3 rounded-full text-[13px] text-left transition-colors duration-150 ${
                open ? 'bg-ink/[0.08] text-text-primary' : 'bg-ink/[0.05] text-text-secondary hover:bg-ink/[0.08]'
              }`}
              onClick={() => setOpen(!open)}
            >
              <Icon
                name={chosen.kind === 'repo-label' ? 'tag' : 'users-three'}
                className="w-4 h-4 shrink-0 text-text-tertiary"
              />
              <span className="flex-1 min-w-0 truncate">{chosen.name}</span>
              <Icon name="caret-down" className="w-3 h-3 shrink-0 text-text-tertiary" />
            </button>
          )}
        >
          {labels.map((label) => (
            <MenuItem
              key={label.id}
              label={label.name}
              hint={label.id === suggested?.id ? 'matches this repo' : undefined}
              selected={scopeKey(chosen) === `label:${label.id}`}
              onClick={() => pick({ kind: 'repo-label', labelId: label.id, name: label.name })}
            />
          ))}

          {labels.length > 0 && teams.length > 0 && <MenuDivider />}

          {teams.map((team) => (
            <MenuItem
              key={team.id}
              label={team.name}
              hint={team.key}
              selected={scopeKey(chosen) === `team:${team.id}`}
              onClick={() => pick({ kind: 'team', teamId: team.id, name: team.name })}
            />
          ))}
        </MenuPopover>

        <button
          type="button"
          className="btn-primary btn-compact h-8 shrink-0"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
