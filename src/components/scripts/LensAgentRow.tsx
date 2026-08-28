import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '../../healthCheck';
import { LENS_AGENTS, resolveLensAgent } from '../../lens/lensAgents';
import { Icon } from '../terminal/Icon';
import { MenuPopover, MenuItem, MenuDivider } from '../ui/Menu';

export function LensAgentRow({ projectPath }: { projectPath: string }) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void window.api.lens.agent(projectPath).then(setChosenId);
  }, [projectPath]);

  // Probed rather than read off the startup cache: an agent installed while the
  // app was open is what this row is most likely to be opened for.
  useEffect(() => {
    void window.api.health.check().then(setHealth);
  }, []);

  const save = useCallback(
    async (next: string | null) => {
      setChosenId(next);
      await window.api.lens.setAgent(projectPath, next);
    },
    [projectPath],
  );

  if (!health) return null;

  const here = LENS_AGENTS.filter((agent) => health[agent.id]);

  if (here.length === 0) {
    return <div className="px-4 py-3 text-[13px] text-text-tertiary">Lenses need Claude Code or Codex installed.</div>;
  }

  // One agent is no decision, and the row could not be acted on.
  if (here.length === 1) return null;

  // In `LENS_AGENTS` order, which is the order a run with nothing chosen picks in.
  const automatic = here[0];
  const auto = !chosenId;
  const showing = resolveLensAgent(chosenId, health) ?? automatic;

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
            void save(null);
          }}
        />
        <MenuDivider />
        {here.map((agent) => (
          <MenuItem
            key={agent.id}
            label={agent.label}
            selected={chosenId === agent.id}
            onClick={() => {
              setOpen(false);
              void save(agent.id);
            }}
          />
        ))}
      </MenuPopover>
    </div>
  );
}
