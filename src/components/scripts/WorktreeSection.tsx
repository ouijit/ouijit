import { useEffect, useMemo, useState } from 'react';
import type { DiffBases } from '../../types';
import { useWorktreeSettingsStore, type WorktreeMode } from '../../stores/worktreeSettingsStore';
import { MenuDivider, MenuItem, MenuPopover } from '../ui/Menu';
import { Icon } from '../terminal/Icon';
import { MAX_BASE_ROWS, searchDiffBases } from '../diff/diffBaseGroups';

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
    description:
      'Just `git worktree add`. Only tracked files appear in the worktree. Configure your setup using the Start hook below.',
  },
];

export function WorktreeSection({ projectPath }: WorktreeSectionProps) {
  const selected = useWorktreeSettingsStore((s) => s.settingsByProject[projectPath]?.mode) ?? 'quick-start';

  const handleSelect = (mode: WorktreeMode) => {
    if (mode === selected) return;
    void useWorktreeSettingsStore.getState().setMode(projectPath, mode);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg">
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
      <div className="glass-bevel relative border border-bezel rounded-[14px] bg-terminal-bg flex items-center gap-4 px-4 py-3">
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-text-primary">Branch from</span>
          <span className="block text-xs text-text-tertiary mt-0.5">
            Where new tasks start. A remote branch is fetched first.
          </span>
        </span>
        <BasePicker projectPath={projectPath} />
      </div>
    </div>
  );
}

const CHECKED_OUT = 'Checked-out branch';
const NO_BASES: DiffBases = { refs: [], upstream: null, defaultRemote: null, lastFetch: null };

function BasePicker({ projectPath }: { projectPath: string }) {
  const base = useWorktreeSettingsStore((s) => s.settingsByProject[projectPath]?.base ?? null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bases, setBases] = useState<DiffBases>(NO_BASES);
  const [mainBranch, setMainBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    let live = true;
    void window.api.listDiffBases(projectPath).then((next) => live && setBases(next));
    void window.api.worktree.getMainBranch(projectPath).then((next) => live && setMainBranch(next));
    return () => {
      live = false;
    };
  }, [open, projectPath]);

  const rows = useMemo(() => {
    if (query) return searchDiffBases(bases.refs, query, null).map((r) => r.ref);
    const present = new Set(bases.refs.map((r) => r.ref));
    const suggested = [mainBranch, bases.defaultRemote && mainBranch ? `${bases.defaultRemote}/${mainBranch}` : null];
    const first = suggested.filter((ref): ref is string => ref != null && present.has(ref));
    return [...first, ...bases.refs.map((r) => r.ref).filter((ref) => !first.includes(ref))];
  }, [bases, mainBranch, query]);

  const choose = (next: string | null) => {
    setOpen(false);
    void useWorktreeSettingsStore.getState().setBase(projectPath, next);
  };

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      className="w-72 max-h-[26rem]"
      trigger={(triggerRef) => (
        <button
          ref={triggerRef}
          type="button"
          className="btn-secondary btn-compact shrink-0 max-w-[14rem] flex items-center gap-1.5"
          onClick={() => setOpen(!open)}
        >
          <span className={`truncate ${base ? 'font-mono text-[13px]' : ''}`}>{base ?? CHECKED_OUT}</span>
          <Icon name="caret-down" className="w-3 h-3 shrink-0" />
        </button>
      )}
      header={
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] bg-ink/[0.05] focus-within:bg-ink/[0.08] transition-colors duration-150">
          <Icon name="magnifying-glass" className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery('');
              }
              if (e.key === 'Enter' && rows.length > 0) choose(rows[0]);
            }}
            placeholder="Find a branch"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
          />
        </label>
      }
    >
      {!query && (
        <>
          <MenuItem label={CHECKED_OUT} selected={base == null} onClick={() => choose(null)} />
          {rows.length > 0 && <MenuDivider />}
        </>
      )}
      {rows.slice(0, MAX_BASE_ROWS).map((ref) => (
        <MenuItem key={ref} label={ref} selected={ref === base} onClick={() => choose(ref)} />
      ))}
      {query && rows.length === 0 && <div className="px-2.5 py-1.5 text-sm text-text-tertiary">No branch matches</div>}
      {rows.length > MAX_BASE_ROWS && (
        <div className="px-2.5 py-1.5 text-[11px] text-text-tertiary">
          +{rows.length - MAX_BASE_ROWS} more{query ? ' matching' : ' — type to filter'}
        </div>
      )}
    </MenuPopover>
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
      className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-ink/[0.02] focus:outline-none focus-visible:bg-ink/[0.03]"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
          checked ? 'border-accent bg-accent' : 'border-ink/30 bg-transparent'
        }`}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-accent-ink" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        <span className="block text-xs text-text-tertiary mt-0.5">{description}</span>
      </span>
    </button>
  );
}
