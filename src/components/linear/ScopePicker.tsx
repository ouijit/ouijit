import { useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
import { Icon } from '../terminal/Icon';
import { MenuDivider, MenuItem, MenuPopover } from '../ui/Menu';

interface ScopePickerProps {
  availability: LinearAvailability;
  value: LinearScope;
  onChange: (scope: LinearScope) => void;
  disabled?: boolean;
  className?: string;
}

export function scopeKey(scope: LinearScope): string {
  return scope.kind === 'repo-label' ? `label:${scope.labelId}` : `team:${scope.teamId}`;
}

/**
 * Which of a workspace's `repo` labels or teams a project's issues come from.
 *
 * One list for both kinds: a workspace can label a repo under a name that is
 * not its own, so the label matched from the git remote is a suggestion rather
 * than a verdict, and the teams sit under it.
 */
export function ScopePicker({ availability, value, onChange, disabled, className }: ScopePickerProps) {
  const [open, setOpen] = useState(false);
  const { repoLabels, teams, suggestedLabel } = availability;

  const pick = (scope: LinearScope) => {
    setOpen(false);
    onChange(scope);
  };

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      className="w-[17rem] max-h-[22rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          title={value.name}
          // The sidebar's search field, one size down: the app has one control
          // shape for a thing you pick from, and this is it.
          className={`flex items-center gap-2 h-8 px-3 rounded-full text-[13px] text-left transition-colors duration-150 disabled:opacity-50 ${
            open ? 'bg-ink/[0.08] text-text-primary' : 'bg-ink/[0.05] text-text-secondary hover:bg-ink/[0.08]'
          } ${className ?? ''}`}
          onClick={() => setOpen(!open)}
        >
          <Icon
            name={value.kind === 'repo-label' ? 'tag' : 'users-three'}
            className="w-4 h-4 shrink-0 text-text-tertiary"
          />
          <span className="flex-1 min-w-0 truncate">{value.name}</span>
          <Icon name="caret-down" className="w-3 h-3 shrink-0 text-text-tertiary" />
        </button>
      )}
    >
      {repoLabels.map((label) => (
        <MenuItem
          key={label.id}
          label={label.name}
          hint={label.id === suggestedLabel?.id ? 'matches this repo' : undefined}
          selected={scopeKey(value) === `label:${label.id}`}
          onClick={() => pick({ kind: 'repo-label', labelId: label.id, name: label.name })}
        />
      ))}

      {repoLabels.length > 0 && teams.length > 0 && <MenuDivider />}

      {teams.map((team) => (
        <MenuItem
          key={team.id}
          label={team.name}
          hint={team.key}
          selected={scopeKey(value) === `team:${team.id}`}
          onClick={() => pick({ kind: 'team', teamId: team.id, name: team.name })}
        />
      ))}
    </MenuPopover>
  );
}

/** What the picker starts on: the matched label, else the first team. */
export function defaultScope(availability: LinearAvailability): LinearScope | null {
  const { suggestedLabel, teams } = availability;
  if (suggestedLabel) return { kind: 'repo-label', labelId: suggestedLabel.id, name: suggestedLabel.name };
  return teams[0] ? { kind: 'team', teamId: teams[0].id, name: teams[0].name } : null;
}
