import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '../../healthCheck';
import { LENS_AGENTS, installedAgents, lensAgent, resolveLensAgent, type LensAgentChoice } from '../../lens/lensAgents';
import { Icon } from '../terminal/Icon';
import { MenuPopover, MenuItem, MenuDivider } from '../ui/Menu';

/**
 * Which agent writes this project's lenses.
 *
 * Left to itself it is the first one installed, which is right on a machine
 * with only one and reasonable everywhere else. What it must not be is a
 * decision nobody can see or overturn: the harnesses are not interchangeable,
 * and either of them can be logged out or out of quota.
 *
 * The line underneath is the command as it will actually be spawned. A preset
 * is somebody else's flags, so what this row owes the reader is what is about
 * to be done with them.
 */
export function LensAgentRow({ projectPath }: { projectPath: string }) {
  const [choice, setChoice] = useState<LensAgentChoice | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void window.api.lens.agent(projectPath).then(setChoice);
  }, [projectPath]);

  // Probed rather than taken from the startup cache: an agent installed while
  // the app was open is the case this row is most likely to be opened for.
  useEffect(() => {
    void window.api.health.check().then(setHealth);
  }, []);

  const save = useCallback(
    async (next: LensAgentChoice) => {
      setChoice(next);
      await window.api.lens.setAgent(projectPath, next);
    },
    [projectPath],
  );

  const installed = installedAgents(health);
  const resolved = resolveLensAgent(choice, installed);
  const auto = !choice?.agentId;

  const label = choice?.agentId ? (lensAgent(choice.agentId)?.label ?? choice.agentId) : 'Automatic';

  const detail = !health
    ? 'Looking for an agent…'
    : resolved
      ? `${resolved.command} ${resolved.args.join(' ')}`.trim()
      : 'No supported agent installed — Claude Code or Codex can write one';

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon name="command" className="shrink-0 w-4 h-4 text-text-tertiary" />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-text-primary">Written by</span>
          <span className="block text-[11px] text-text-tertiary font-mono truncate" title={detail}>
            {detail}
          </span>
        </span>

        <MenuPopover
          open={open}
          onOpenChange={setOpen}
          className="w-64 max-h-[22rem]"
          trigger={(ref) => (
            <button
              ref={ref}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
              onClick={() => setOpen(!open)}
            >
              {label}
              <Icon name="caret-down" className="w-3 h-3 opacity-60" />
            </button>
          )}
        >
          <MenuItem
            label="Automatic"
            hint={resolved && auto ? resolved.label : undefined}
            selected={auto}
            onClick={() => {
              setOpen(false);
              void save({ agentId: null });
            }}
          />
          <MenuDivider />
          {LENS_AGENTS.map((agent) => (
            <MenuItem
              key={agent.id}
              label={agent.label}
              // Named rather than hidden: which of these this machine has is
              // worth knowing here, where the answer decides what a lens costs
              // to write.
              hint={installed[agent.id] ? undefined : 'not installed'}
              disabled={!installed[agent.id]}
              selected={choice?.agentId === agent.id}
              onClick={() => {
                setOpen(false);
                void save({ agentId: agent.id });
              }}
            />
          ))}
        </MenuPopover>
      </div>
    </div>
  );
}
