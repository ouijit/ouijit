import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '../../healthCheck';
import {
  LENS_AGENTS,
  installedAgents,
  lensAgent,
  resolveLensAgent,
  type LensAgentChoice,
} from '../../github/lensAgents';
import { Icon } from '../terminal/Icon';
import { MenuPopover, MenuItem, MenuDivider } from '../ui/Menu';

/**
 * Which agent writes this project's lenses.
 *
 * Left to itself it is the first one installed, which is the right answer on
 * the machines that only have one and a reasonable one everywhere else. What
 * it must not be is a decision nobody can see or overturn: the four harnesses
 * are not interchangeable, an agent can be logged out or out of quota, and
 * until this row existed the choice was stored, read on every run, and
 * unreachable.
 *
 * The line underneath is the command as it will actually be spawned. A preset
 * is somebody else's flags, so the one thing this row owes the reader is what
 * we are about to do with them.
 */
export function LensAgentRow({ projectPath }: { projectPath: string }) {
  const [choice, setChoice] = useState<LensAgentChoice | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [open, setOpen] = useState(false);
  /** Non-null while the custom command is being typed. */
  const [custom, setCustom] = useState<string | null>(null);

  useEffect(() => {
    void window.api.github.lensAgent(projectPath).then(setChoice);
  }, [projectPath]);

  // Probed rather than taken from the startup cache: an agent installed while
  // the app was open is the case this row is most likely to be opened for.
  useEffect(() => {
    void window.api.health.check().then(setHealth);
  }, []);

  const save = useCallback(
    async (next: LensAgentChoice) => {
      setChoice(next);
      await window.api.github.setLensAgent(projectPath, next);
    },
    [projectPath],
  );

  const installed = installedAgents(health);
  const resolved = resolveLensAgent(choice, installed);
  const auto = !choice?.agentId && !choice?.command;

  const label = choice?.command
    ? 'Custom'
    : choice?.agentId
      ? (lensAgent(choice.agentId)?.label ?? choice.agentId)
      : 'Automatic';

  const detail = !health
    ? 'Looking for an agent…'
    : resolved
      ? `${resolved.command} ${resolved.args.join(' ')}`.trim()
      : 'No agent installed — Claude Code, Codex, Pi and opencode can each write one';

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
              setCustom(null);
              void save({ agentId: null });
            }}
          />
          <MenuDivider />
          {LENS_AGENTS.map((agent) => (
            <MenuItem
              key={agent.id}
              label={agent.label}
              // Named rather than hidden: which of the four this machine has is
              // worth knowing here, where the answer decides what a lens costs
              // to write.
              hint={installed[agent.id] ? undefined : 'not installed'}
              disabled={!installed[agent.id]}
              selected={!choice?.command && choice?.agentId === agent.id}
              onClick={() => {
                setOpen(false);
                setCustom(null);
                void save({ agentId: agent.id });
              }}
            />
          ))}
          <MenuDivider />
          <MenuItem
            label="Custom command…"
            selected={Boolean(choice?.command)}
            onClick={() => {
              setOpen(false);
              setCustom(choice?.command ?? '');
            }}
          />
        </MenuPopover>
      </div>

      {custom !== null && (
        <div className="mt-3 pl-7">
          {/* The escape hatch the presets have always had a slot for: an agent
              that is not one of the four, or one whose flags have moved since
              this version shipped. Spawned without a shell, so it is a binary
              and its arguments — the prompt still goes in on stdin. */}
          <input
            autoFocus
            className="w-full px-2.5 py-1.5 text-xs font-mono text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors"
            placeholder="my-agent --one-shot"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCustom(null);
              if (e.key !== 'Enter') return;
              const command = custom.trim();
              setCustom(null);
              void save({ agentId: choice?.agentId ?? null, ...(command ? { command } : {}) });
            }}
          />
          <p className="mt-1.5 text-[11px] text-text-tertiary leading-relaxed">
            Run as-is, with the prompt on stdin. Leave it empty to go back to the presets.
          </p>
        </div>
      )}
    </div>
  );
}
