import { useState, type ReactNode } from 'react';
import { ScriptList } from '../scripts/ScriptList';
import { HookList, type HookEntry } from '../scripts/HookList';
import { HookRowView } from '../scripts/HookRowView';
import { RemoveProjectRow } from '../scripts/RemoveProjectRow';
import { SandboxSection } from '../scripts/SandboxSection';
import { ExperimentalFeaturesSection } from '../scripts/ExperimentalFeaturesSection';
import { LinearScopeSection } from '../linear/LinearScopeSection';
import { WorktreeSection } from '../scripts/WorktreeSection';
import { IconColorSection } from '../scripts/IconColorSection';
import { LensList } from '../scripts/LensList';
import { LensAgentRow } from '../scripts/LensAgentRow';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';
import { AgentPicker } from '../chat/AgentPicker';
import { ChatTaskStartDialog } from '../dialogs/ChatTaskStartDialog';
import { saveTaskOpening, useProjectConfig } from '../../stores/projectDataStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { DEFAULT_TASK_OPENING, type TaskOpening, type TaskSurface } from '../../chat/preferences';

const PANEL =
  'glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg';

function Part({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className={`text-sm font-semibold text-text-primary ${description ? 'mb-1' : 'mb-3'}`}>{title}</h2>
      {description && <p className="text-xs text-text-tertiary mb-3">{description}</p>}
      {children}
    </section>
  );
}

const OPENING_HOOKS: HookEntry[] = [
  { type: 'start', label: 'Start', description: 'Runs when a task moves to In Progress' },
  { type: 'continue', label: 'Continue', description: 'Runs when reopening an In Progress task' },
];

const MOVING_ON_HOOKS: HookEntry[] = [
  { type: 'review', label: 'Review', description: 'Runs when a task moves to In Review' },
  { type: 'done', label: 'Done', description: 'Runs when a task moves to Done' },
];

const RUN_HOOK: HookEntry[] = [{ type: 'run', label: 'Run', description: "Runs from a terminal's + menu" }];

const EDITOR_HOOK: HookEntry[] = [
  { type: 'editor', label: 'Editor', description: 'Opens the task worktree in your editor' },
];

export function ProjectGeneralSettings({ projectPath }: { projectPath: string }) {
  return (
    <>
      <Part title="Appearance" description="How this project looks in the sidebar.">
        <IconColorSection projectPath={projectPath} />
      </Part>
      <Part title="Editor" description="Command to open task worktrees in your editor.">
        <HookList projectPath={projectPath} hooks={EDITOR_HOOK} />
      </Part>
      <Part title="Experimental" description="Unstable features that may change or be removed in future releases.">
        <ExperimentalFeaturesSection projectPath={projectPath} />
      </Part>
      <section>
        <RemoveProjectRow projectPath={projectPath} />
      </section>
    </>
  );
}

function TaskOpeningPanel({ projectPath }: { projectPath: string }) {
  const chatEnabled = useHomeChatStore((s) => s.enabled);
  const opening = useProjectConfig(projectPath)?.taskOpening ?? DEFAULT_TASK_OPENING;
  const [editingChatStart, setEditingChatStart] = useState(false);
  const update = (patch: Partial<TaskOpening>) => void saveTaskOpening(projectPath, { ...opening, ...patch });

  if (!chatEnabled) return <HookList projectPath={projectPath} hooks={OPENING_HOOKS} />;
  const chat = opening.surface === 'chat';
  return (
    <div className="space-y-3">
      <div className={PANEL}>
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Open in</div>
            <div className="text-xs text-text-tertiary mt-0.5">A task can have more of either, from its menu.</div>
          </div>
          <SegmentedGroup>
            {(['terminal', 'chat'] as TaskSurface[]).map((surface) => (
              <button
                key={surface}
                type="button"
                aria-pressed={opening.surface === surface}
                className={`${segmentBase} ${opening.surface === surface ? segmentAccent : segmentQuiet}`}
                onClick={() => update({ surface })}
              >
                {surface === 'chat' ? 'Chat' : 'Terminal'}
              </button>
            ))}
          </SegmentedGroup>
        </div>
        {chat && (
          <AgentPicker
            agent={opening.agent}
            ariaLabel="Choose the task chat agent"
            onChange={(agent) => update({ agent })}
          />
        )}
      </div>
      {chat ? (
        <div className={PANEL}>
          <HookRowView
            label="Setup"
            description="Runs before the task chat starts"
            command={opening.setup || undefined}
            onAction={() => setEditingChatStart(true)}
          />
          <HookRowView
            label="First message"
            description="Sent once Setup succeeds"
            command={opening.firstMessage || undefined}
            onAction={() => setEditingChatStart(true)}
          />
        </div>
      ) : (
        <HookList projectPath={projectPath} hooks={OPENING_HOOKS} />
      )}
      {editingChatStart && <ChatTaskStartDialog projectPath={projectPath} onClose={() => setEditingChatStart(false)} />}
    </div>
  );
}

export function ProjectTasksSettings({ projectPath }: { projectPath: string }) {
  return (
    <>
      <Part title="Opening a task" description="What happens when a task moves to In Progress, or is reopened there.">
        <TaskOpeningPanel projectPath={projectPath} />
      </Part>
      <Part title="Moving a task on">
        <HookList projectPath={projectPath} hooks={MOVING_ON_HOOKS} />
      </Part>
      <Part title="Worktrees" description="How task worktrees are created from this project.">
        <WorktreeSection projectPath={projectPath} />
      </Part>
    </>
  );
}

export function ProjectScriptsSettings({ projectPath }: { projectPath: string }) {
  return (
    <Part title="Run commands" description="Commands you can launch from a terminal's + menu.">
      <div className={PANEL}>
        <HookList projectPath={projectPath} hooks={RUN_HOOK} bare />
        <ScriptList projectPath={projectPath} bare />
      </div>
    </Part>
  );
}

export function ProjectLensesSettings({ projectPath }: { projectPath: string }) {
  return (
    <Part
      title="Lenses"
      description="Ways of reading a diff. Each is a command that reads the change and says what its parts are, so the diff can be shown in that order instead of a list of files."
    >
      <LensList projectPath={projectPath} />
      <div className="mt-3 -ml-2.5">
        <LensAgentRow projectPath={projectPath} />
      </div>
    </Part>
  );
}

export function ProjectSandboxSettings({ projectPath }: { projectPath: string }) {
  return (
    <Part title="Sandbox" description="Where this project runs things, and what a sandbox can reach.">
      <SandboxSection projectPath={projectPath} />
    </Part>
  );
}

export function ProjectLinearSettings({ projectPath }: { projectPath: string }) {
  return (
    <Part title="Linear" description="Which Linear issues show in this project.">
      <LinearScopeSection projectPath={projectPath} />
    </Part>
  );
}
