import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '../../healthCheck';
import { LENS_AGENTS, installedAgents, resolveLensAgent, type LensAgentChoice } from '../../lens/lensAgents';
import { Icon } from '../terminal/Icon';
import { MenuPopover, MenuItem, MenuDivider } from '../ui/Menu';

/**
 * Which agent writes this project's lenses, where that is still a question. Both
 * are held to the same schema and isolated the same way, so the choice is about
 * whose quota pays and which one is logged in — and nothing is drawn where there
 * is no choice to make.
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

  // Nothing at all until the probe answers, rather than a row that appears and
  // then decides it does not belong here.
  if (!health) return null;

  const installed = installedAgents(health);
  const here = LENS_AGENTS.filter((agent) => installed[agent.id]);

  // Nothing can write a lens, said here rather than left for a run to fail on.
  if (here.length === 0) {
    return <div className="px-4 py-3 text-[13px] text-text-tertiary">Lenses need Claude Code or Codex installed.</div>;
  }

  // One agent is no decision. Naming it would be a row that cannot be acted on.
  if (here.length === 1) return null;

  // `here` is the installed agents in preference order, so its first is what a
  // run with nothing chosen will use.
  const automatic = here[0];
  const auto = !choice?.agentId;
  // What will run, never how it was decided: nothing has been chosen to begin
  // with, and "Automatic" makes the reader open it to find out what that means.
  const showing = resolveLensAgent(choice, installed) ?? automatic;

  return (
    <div className="flex items-center px-1.5 py-1.5">
      <MenuPopover
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        className="w-64 max-h-[22rem]"
        trigger={(ref) => (
          <button
            ref={ref}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            title="Which agent reads a change and writes the grouping"
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
            onClick={() => setOpen(!open)}
          >
            {showing.label}
            <Icon name="caret-down" className="w-3 h-3 opacity-60" />
          </button>
        )}
      >
        <MenuItem
          label="Automatic"
          hint={automatic.label}
          selected={auto}
          onClick={() => {
            setOpen(false);
            void save({ agentId: null });
          }}
        />
        <MenuDivider />
        {here.map((agent) => (
          <MenuItem
            key={agent.id}
            label={agent.label}
            selected={choice?.agentId === agent.id}
            onClick={() => {
              setOpen(false);
              void save({ agentId: agent.id });
            }}
          />
        ))}
      </MenuPopover>
    </div>
  );
}
