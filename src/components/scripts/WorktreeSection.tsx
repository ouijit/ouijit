import { useWorktreeSettingsStore, type WorktreeMode } from '../../stores/worktreeSettingsStore';

interface WorktreeSectionProps {
  projectPath: string;
}

interface ModeOption {
  value: WorktreeMode;
  label: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'quick-start',
    label: 'Quick start',
    description:
      'Instant, ready-to-go worktree. Gitignored files (deps, configs, secrets) are copied via Copy-on-Write. Less control over what ends up in the worktree.',
  },
  {
    value: 'clean-checkout',
    label: 'Clean checkout',
    description: 'Just `git worktree add` — only tracked files. Configure your setup using the Start hook below.',
  },
];

export function WorktreeSection({ projectPath }: WorktreeSectionProps) {
  const selected = useWorktreeSettingsStore((s) => s.settingsByProject[projectPath]?.mode) ?? 'quick-start';

  const handleSelect = (mode: WorktreeMode) => {
    if (mode === selected) return;
    void useWorktreeSettingsStore.getState().setMode(projectPath, mode);
  };

  return (
    <div className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06] bg-[var(--color-terminal-bg,#171717)]">
      {MODE_OPTIONS.map((option) => (
        <ModeRow
          key={option.value}
          label={option.label}
          description={option.description}
          checked={selected === option.value}
          onSelect={() => handleSelect(option.value)}
        />
      ))}
    </div>
  );
}

interface ModeRowProps {
  label: string;
  description: string;
  checked: boolean;
  onSelect: () => void;
}

function ModeRow({ label, description, checked, onSelect }: ModeRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-white/[0.02] focus:outline-none focus-visible:bg-white/[0.03]"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
          checked ? 'border-blue-500 bg-blue-500' : 'border-white/30 bg-transparent'
        }`}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        <span className="block text-xs text-text-tertiary mt-0.5">{description}</span>
      </span>
    </button>
  );
}
