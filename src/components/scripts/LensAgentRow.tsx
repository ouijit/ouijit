import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '../../healthCheck';
import {
  LENS_AGENTS,
  installedAgents,
  pickLensAgent,
  resolveLensAgent,
  type LensAgentChoice,
} from '../../lens/lensAgents';
import { Icon } from '../terminal/Icon';
import { MenuPopover, MenuItem, MenuDivider } from '../ui/Menu';

/**
 * Which agent writes this project's lenses, where that is still a question.
 *
 * Both agents are held to the same schema and isolated from the repository the
 * same way, so which one wrote a lens does not change what comes back. What it
 * changes is whose quota paid for it, and either can be logged out — so the
 * choice is offered where there is one to make, and nothing is drawn where
 * there is not.
 *
 * The flags are not shown. They were worth showing while a custom command made
 * them editable; a preset nobody can change is a command line the reader can do
 * nothing with, and the runner logs the invocation for anyone who needs it.
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

  // Nothing at all until the probe answers, rather than a row that says it is
  // looking and then changes its mind about whether it belongs here.
  if (!health) return null;

  const installed = installedAgents(health);
  const here = LENS_AGENTS.filter((agent) => installed[agent.id]);

  // Nothing can write a lens, which is the only thing worth saying — and it is
  // said here rather than left for the run to fail with.
  if (here.length === 0) {
    return <div className="px-4 py-3 text-[13px] text-text-tertiary">Lenses need Claude Code or Codex installed.</div>;
  }

  // One agent is no decision. Naming it would be a row that cannot be acted on.
  if (here.length === 1) return null;

  const automatic = pickLensAgent(installed);
  const auto = !choice?.agentId;
  // What will run, never how it was decided. Nothing has been chosen to begin
  // with, and a control reading "Automatic" leaves the reader to open it to
  // find out what that means when the answer is one word long.
  const showing = resolveLensAgent(choice, installed) ?? here[0];

  return (
    // The button's own padding puts its text where the rows above start theirs.
    <div className="flex items-center px-1.5 py-1.5">
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
          hint={automatic?.label}
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
