import { Tooltip } from '../ui/Tooltip';
import { Icon } from '../terminal/Icon';

/**
 * Info icon + tooltip shown next to hook command fields. Explains that a hook
 * runs in the task's worktree and that an agent started there can inspect and
 * update the task through the ouijit CLI — which is what lets command
 * placeholders be plain-language prompts instead of env-var plumbing.
 */
export function HookCliHint({ placement = 'top' }: { placement?: 'top' | 'bottom' | 'right' }) {
  return (
    <Tooltip
      placement={placement}
      text={
        <span className="block max-w-[260px] whitespace-normal leading-snug font-normal">
          Hooks run in the task&apos;s worktree. An agent started here can inspect and update the task with the ouijit
          CLI.
        </span>
      }
    >
      <Icon
        name="info"
        className="w-[18px] h-[18px] text-text-tertiary hover:text-text-secondary transition-colors duration-100"
      />
    </Tooltip>
  );
}
