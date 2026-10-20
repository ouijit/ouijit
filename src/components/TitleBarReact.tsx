import { useAppStore, selectIsCloning, type ProjectPage } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { projectIconColor, getInitials } from '../utils/projectIcon';
import { Icon } from './terminal/Icon';
import { openShell } from './navigation';
import { useProjectFlags } from '../stores/experimentalStore';
import { openTaskComposer } from '../utils/openTaskComposer';
import { Tooltip } from './ui/Tooltip';
import { useShallow } from 'zustand/react/shallow';
import { stackMembers, stackOf, tagUnit, unitsOf, useTerminalStore } from '../stores/terminalStore';

const isMac = navigator.platform.toLowerCase().includes('mac');

export const PAGE_TITLES: Record<ProjectPage, string> = {
  board: 'Board',
  settings: 'Settings',
  'pull-requests': 'Pull requests',
  analysis: 'Analysis',
};

const iconButton =
  'w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5';
const raisedButton =
  'w-9 h-9 flex items-center justify-center bg-background-secondary glass-bevel relative border border-bezel rounded-[14px] text-text-secondary transition-all duration-150 ease-out ml-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5';

/** What the stack on screen holds: one task by name, a whole project or tag, or a count. */
function useShownStackName(): string | null {
  const stack = useAppStore((s) => (s.selection.kind === 'terminal' ? s.selection.stack : null));
  const shape = useTerminalStore(
    useShallow((s) => {
      if (!stack) return null;
      const members = stackMembers(s, stack).map((id) => s.displayStates[id]);
      const [front] = members;
      if (!front) return null;
      const [unit, ...more] = unitsOf(stack);
      // Spelled as the sidebar's tag group is: as the first terminal opened with it has it.
      const tag =
        more.length === 0 && unit.startsWith('tag:')
          ? Object.values(s.terminalsByProject)
              .flat()
              .flatMap((id) => s.displayStates[id]?.tags ?? [])
              .find((t) => tagUnit(t) === unit)
          : undefined;
      return {
        whole: more.length === 0 && unit.startsWith('project:') ? 'All terminals' : (tag ?? null),
        stacks: new Set(members.map(stackOf)).size,
        terminals: members.length,
        shells: members.some((d) => d.taskId == null),
        projectPath: front.projectPath,
        taskId: front.taskId,
      };
    }),
  );
  const taskName = useAppStore((s) =>
    shape && shape.taskId != null
      ? (s.taskCacheByProject[shape.projectPath]?.find((t) => t.taskNumber === shape.taskId)?.name ?? null)
      : null,
  );
  if (!shape) return null;
  if (shape.whole) return shape.whole;
  if (shape.stacks === 1) return taskName;
  return shape.shells ? `${shape.terminals} terminals` : `${shape.stacks} tasks`;
}

export function TitleBar() {
  const selection = useAppStore((s) => s.selection);
  const project = useAppStore((s) => s.activeProjectData);
  // A cloning project has no directory yet, so nothing here may act on its path.
  const cloning = useAppStore(selectIsCloning);
  const fullscreen = useAppStore((s) => s.fullscreen);
  const sidebarShown = useUIStore((s) => s.sidebarShown);
  const sidebarRevealed = useUIStore((s) => s.sidebarRevealed);
  const terminalLayout = useProjectStore((s) => s.terminalLayout);
  const flags = useProjectFlags(project && !cloning ? project.path : null);

  const stackName = useShownStackName();
  const page = selection.kind === 'page' && !cloning ? PAGE_TITLES[selection.page] : stackName;
  const showsTerminal = selection.kind === 'terminal';
  const onSettings = selection.kind === 'app-settings' || (selection.kind === 'page' && selection.page === 'settings');
  const offersCreation = !cloning && !onSettings;
  // With the sidebar out of the way the traffic lights sit over the title bar.
  const leftPad = !sidebarShown && !sidebarRevealed && isMac && !fullscreen ? 88 : 16;

  return (
    <header
      className="sticky top-0 relative z-[10000] [-webkit-app-region:drag]"
      style={
        {
          background: 'color-mix(in srgb, var(--color-background) 97%, transparent)',
          WebkitAppRegion: 'drag',
          paddingTop: 'env(titlebar-area-height, 0px)',
        } as React.CSSProperties
      }
    >
      <div
        className="box-content h-9 flex items-center gap-2 pt-4 pb-2 pr-4 transition-[padding-left] duration-200"
        style={{ paddingLeft: `calc(var(--sidebar-offset, 0px) + ${leftPad}px)` }}
      >
        {!sidebarShown && (
          <div className="flex items-center h-9 shrink-0 [-webkit-app-region:no-drag]">
            <Tooltip text="Show sidebar" placement="bottom-start">
              <button
                type="button"
                className={iconButton}
                aria-label="Show sidebar"
                onClick={() => useUIStore.getState().setSidebarShown(true)}
              >
                <Icon name="sidebar-simple" />
              </button>
            </Tooltip>
          </div>
        )}
        {project && (
          <div className="flex items-center gap-3 ml-1.5 min-w-0">
            <div
              className="w-8 h-8 shrink-0 overflow-hidden rounded-md flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: projectIconColor(project), textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
            >
              {getInitials(project.name)}
            </div>
            <div className="flex flex-col gap-[2px] min-w-0">
              <span className="text-[15px] font-semibold text-text-primary leading-none tracking-tight truncate">
                {project.name}
                {page && (
                  <>
                    <Icon name="caret-right" className="inline-block w-3 h-3 mx-1.5 align-[-1px] text-text-tertiary" />
                    <span className="font-normal text-text-tertiary">{page}</span>
                  </>
                )}
              </span>
              <span className="text-[11px] font-mono text-text-tertiary leading-[1.3] truncate">
                {project.path.replace(/^\/Users\/[^/]+/, '~')}
              </span>
            </div>
          </div>
        )}
        <div className="flex-1" />
        {showsTerminal && flags.canvas && (
          <Tooltip text={terminalLayout === 'canvas' ? 'Stack' : 'Canvas'} placement="bottom">
            <button
              className={raisedButton}
              aria-label="Canvas"
              aria-pressed={terminalLayout === 'canvas'}
              onClick={() => useProjectStore.getState().toggleTerminalLayout()}
            >
              {terminalLayout === 'canvas' ? <Icon name="cards-three" /> : <CanvasIcon />}
            </button>
          </Tooltip>
        )}
        {offersCreation && (
          <Tooltip text="New terminal" placement="bottom">
            <button
              className={raisedButton}
              aria-label="New terminal"
              onClick={async () => openShell(project?.path ?? (await window.api.homePath()))}
            >
              <Icon name="terminal" />
            </button>
          </Tooltip>
        )}
        {project && offersCreation && (
          <Tooltip text="New task" placement="bottom-end">
            <button className={raisedButton} aria-label="New task" onClick={() => openTaskComposer()}>
              <Icon name="plus" />
            </button>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

/** Inline canvas/artboard icon — no Phosphor equivalent available. */
function CanvasIcon() {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" className="w-5 h-5 shrink-0">
      <rect x="40" y="40" width="72" height="72" rx="8" opacity="0.9" />
      <rect x="144" y="40" width="72" height="52" rx="8" opacity="0.7" />
      <rect x="40" y="144" width="72" height="52" rx="8" opacity="0.7" />
      <rect x="144" y="124" width="72" height="72" rx="8" opacity="0.9" />
    </svg>
  );
}
