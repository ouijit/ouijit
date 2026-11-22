import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Icon } from './Icon';
import { terminalInstances } from './terminalRegistry';
import { startRunner } from './terminalActions';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { ScriptConfigDialog } from '../dialogs/ScriptConfigDialog';
import { isHomeChat } from '../../stores/homeChatStore';
import { runnerPlace, setRunnerSandbox, useProjectConfig, useProjectScripts } from '../../stores/projectDataStore';
import { SANDBOX_LABELS, isActiveSandbox } from '../../types';
import type { RunnerScript, Script, ScriptHook, SandboxProviderId } from '../../types';
import type { MarkdownFile } from '../../markdownFiles';

/**
 * What is typed into a new tab, and the page's handling of its keys. The field
 * sits in the tab row and the list in the panel below it, so they meet here.
 */
const useNewTabStore = create<{
  query: Record<string, string>;
  keys: Record<string, (e: React.KeyboardEvent) => void>;
}>(() => ({ query: {}, keys: {} }));

function setQuery(panelId: string, value: string): void {
  useNewTabStore.setState((s) => ({ query: { ...s.query, [panelId]: value } }));
}

function forget(panelId: string): void {
  useNewTabStore.setState((s) => {
    const { [panelId]: _q, ...query } = s.query;
    const { [panelId]: _k, ...keys } = s.keys;
    return { query, keys };
  });
}

function fieldLabel(ptyId: string): string {
  return isHomeChat(ptyId) ? 'Open a file, or enter a URL' : 'Run a script, open a file, or enter a URL';
}

/** The open new tab, typed into where its title goes. */
export function NewTabField({ ptyId, panelId, onClose }: { ptyId: string; panelId: string; onClose: () => void }) {
  const query = useNewTabStore((s) => s.query[panelId] ?? '');
  return (
    <div className="h-7 flex-[2_1_0] min-w-0 max-w-[320px] flex items-center gap-1.5 pl-2 pr-1 rounded-md bg-ink/[0.1] ring-1 ring-inset ring-ink/15">
      <Icon name="magnifying-glass" className="w-3.5 h-3.5 shrink-0 text-ink/50" />
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(panelId, e.target.value)}
        onKeyDown={(e) => useNewTabStore.getState().keys[panelId]?.(e)}
        placeholder="New tab"
        aria-label={fieldLabel(ptyId)}
        spellCheck={false}
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-ink/90 placeholder:text-ink/55"
      />
      <button
        type="button"
        aria-label="Close New tab"
        onClick={onClose}
        className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full border-none bg-transparent text-inherit opacity-70 hover:opacity-100 hover:bg-ink/10 [&>svg]:w-3 [&>svg]:h-3"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

interface Row {
  key: string;
  icon: string;
  title: string;
  detail?: string;
  /** An action on the list rather than something to open, drawn quieter. */
  quiet?: boolean;
  act: () => void;
  edit?: { label: string; onClick: () => void };
}

interface Group {
  title?: string;
  aside?: ReactNode;
  rows: Row[];
}

const RECENT_FILES = 5;
const MATCHED_FILES = 50;

/** A port alone means one on this machine; anything else needs a scheme the preview can load. */
export function previewUrl(typed: string): string | null {
  const q = typed.trim();
  if (!q || /\s/.test(q) || /\.md$/i.test(q)) return null;
  if (/^:?\d{2,5}$/.test(q)) return `http://localhost:${q.replace(':', '')}`;
  if (/^https?:\/\//i.test(q)) return q;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(q)) return `http://${q}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(q)) return `https://${q}`;
  return null;
}

const matches = (query: string, ...texts: (string | undefined)[]) => {
  const q = query.trim().toLowerCase();
  return !q || texts.some((t) => t?.toLowerCase().includes(q));
};

function useMarkdownFiles(dir: string): MarkdownFile[] {
  const [files, setFiles] = useState<MarkdownFile[]>([]);
  useEffect(() => {
    let live = true;
    void window.api.plan.listFiles(dir).then((found) => live && setFiles(found));
    return () => {
      live = false;
    };
  }, [dir]);
  return files;
}

function useFileGroup(dir: string, query: string, open: (path: string) => void): Group {
  const files = useMarkdownFiles(dir);
  const [expanded, setExpanded] = useState(false);
  const relative = (p: string) => (p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p);
  const found = files.filter((f) => matches(query, relative(f.path)));
  const shown = query ? found.slice(0, MATCHED_FILES) : expanded ? found : found.slice(0, RECENT_FILES);
  const rows: Row[] = shown.map((f) => {
    const rel = relative(f.path);
    const cut = rel.lastIndexOf('/');
    return {
      key: f.path,
      icon: 'file-text',
      title: rel.slice(cut + 1),
      detail: cut === -1 ? undefined : rel.slice(0, cut + 1),
      act: () => open(f.path),
    };
  });
  if (!query && !expanded && found.length > RECENT_FILES)
    rows.push({
      key: 'more-files',
      icon: 'dots-three',
      title: `${found.length - RECENT_FILES} more`,
      quiet: true,
      act: () => setExpanded(true),
    });
  return { title: 'Files', rows };
}

function urlRow(query: string, open: (url: string) => void): Row | null {
  const url = previewUrl(query);
  if (!url) return null;
  return { key: 'url', icon: 'globe-simple', title: `Open ${url.replace(/^https?:\/\//, '')}`, act: () => open(url) };
}

/** What a new tab can become: one of the panel's own kinds, put in its place. */
export function NewTabPage({ ptyId, panelId }: { ptyId: string; panelId: string }) {
  useEffect(
    () => () => {
      if (!terminalInstances.get(ptyId)?.panels.some((p) => p.id === panelId)) forget(panelId);
    },
    [ptyId, panelId],
  );
  return isHomeChat(ptyId) ? (
    <FilesAndPages ptyId={ptyId} panelId={panelId} />
  ) : (
    <ScriptsFilesAndPages ptyId={ptyId} panelId={panelId} />
  );
}

function useOpeners(ptyId: string, panelId: string) {
  const instance = () => terminalInstances.get(ptyId);
  return {
    dir: instance()?.worktreePath || instance()?.projectPath || '',
    openFile: (path: string) => instance()?.addPlanPanel(path, true, panelId),
    openUrl: (url: string) => instance()?.addWebPreviewPanel(url, { replacing: panelId }),
    cancel: () => instance()?.closePanel(panelId),
  };
}

function FilesAndPages({ ptyId, panelId }: { ptyId: string; panelId: string }) {
  const query = useNewTabStore((s) => s.query[panelId] ?? '');
  const open = useOpeners(ptyId, panelId);
  const files = useFileGroup(open.dir, query, open.openFile);
  return <List panelId={panelId} query={query} groups={withUrl(query, [files], open.openUrl)} onCancel={open.cancel} />;
}

/** A URL typed is offered first, unless it also names a file, which it then follows. */
function withUrl(query: string, groups: Group[], openUrl: (url: string) => void): Group[] {
  const url = urlRow(query, openUrl);
  const kept = groups.filter((g) => g.rows.length > 0);
  if (!url) return kept;
  return kept.length > 0 ? [...kept, { rows: [url] }] : [{ rows: [url] }];
}

function ScriptsFilesAndPages({ ptyId, panelId }: { ptyId: string; panelId: string }) {
  const query = useNewTabStore((s) => s.query[panelId] ?? '');
  const open = useOpeners(ptyId, panelId);
  const projectPath = terminalInstances.get(ptyId)?.projectPath ?? '';
  const config = useProjectConfig(projectPath);
  const scripts = useProjectScripts(projectPath);
  const files = useFileGroup(open.dir, query, open.openFile);
  const [dialog, setDialog] = useState<
    { kind: 'run'; existing?: ScriptHook } | { kind: 'script'; existing?: Script } | null
  >(null);
  const [placeMenu, setPlaceMenu] = useState<{ x: number; y: number } | null>(null);

  const place = runnerPlace(config);
  const places = config ? runnablePlaces(config.defaultSandbox, place, config.availableSandboxProviders) : [];
  const run = (script?: RunnerScript) =>
    void startRunner(ptyId, script, isActiveSandbox(place) ? place : undefined, panelId);

  const groups: Group[] = [];
  if (config && scripts) {
    const rows: Row[] = [];
    const runHook = config.hooks.run;
    if (runHook && matches(query, 'Run', runHook.command))
      rows.push({
        key: 'run',
        icon: 'play',
        title: 'Run',
        detail: runHook.command,
        act: () => run(),
        edit: { label: 'Edit Run', onClick: () => setDialog({ kind: 'run', existing: runHook }) },
      });
    for (const script of scripts.filter((s) => matches(query, s.name, s.command)))
      rows.push({
        key: script.id,
        icon: 'play',
        title: script.name,
        detail: script.command,
        act: () => run(script),
        edit: { label: `Edit ${script.name}`, onClick: () => setDialog({ kind: 'script', existing: script }) },
      });
    if (!query) {
      if (!runHook)
        rows.push({
          key: 'configure-run',
          icon: 'plus',
          title: 'Configure run command…',
          quiet: true,
          act: () => setDialog({ kind: 'run' }),
        });
      rows.push({
        key: 'new-script',
        icon: 'plus',
        title: 'New script…',
        quiet: true,
        act: () => setDialog({ kind: 'script' }),
      });
    }
    groups.push({
      title: 'Scripts',
      rows,
      aside: places.length > 1 && (
        <button
          type="button"
          aria-label="Run in"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPlaceMenu({ x: r.left, y: r.bottom + 4 });
          }}
          className="h-5 -my-0.5 px-1 flex items-center gap-1 rounded border-none bg-transparent text-[12px] font-normal text-ink/45 hover:text-ink/80 hover:bg-ink/[0.06]"
        >
          in {SANDBOX_LABELS[place]}
          <Icon name="caret-down" className="w-3 h-3" />
        </button>
      ),
    });
  }
  groups.push(files);

  return (
    <>
      <List panelId={panelId} query={query} groups={withUrl(query, groups, open.openUrl)} onCancel={open.cancel} />
      {placeMenu && config && (
        <ContextMenu
          x={placeMenu.x}
          y={placeMenu.y}
          items={places.map((option): ContextMenuEntry => ({
            label: option === config.defaultSandbox ? `Default (${SANDBOX_LABELS[option]})` : SANDBOX_LABELS[option],
            checked: option === place,
            onClick: () => void setRunnerSandbox(projectPath, option),
          }))}
          onClose={() => setPlaceMenu(null)}
        />
      )}
      {dialog?.kind === 'run' && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType="run"
          existingHook={dialog.existing}
          onClose={(hook) => {
            setDialog(null);
            if (hook && !dialog.existing) run();
          }}
        />
      )}
      {dialog?.kind === 'script' && (
        <ScriptConfigDialog
          projectPath={projectPath}
          existing={dialog.existing}
          onClose={(script) => {
            setDialog(null);
            if (script && !dialog.existing) run(script);
          }}
        />
      )}
    </>
  );
}

function runnablePlaces(
  projectDefault: SandboxProviderId,
  place: SandboxProviderId,
  available: SandboxProviderId[],
): SandboxProviderId[] {
  const places: SandboxProviderId[] = ['none', ...available];
  for (const kept of [projectDefault, place]) if (!places.includes(kept)) places.push(kept);
  return places.sort((a, b) => Number(b === projectDefault) - Number(a === projectDefault));
}

/**
 * The rows, picked with the pointer or from the field with the arrow keys and
 * Enter. Nothing is marked until something is typed or an arrow pressed, so
 * Enter on an untouched tab starts nothing.
 */
function List({
  panelId,
  query,
  groups,
  onCancel,
}: {
  panelId: string;
  query: string;
  groups: Group[];
  onCancel: () => void;
}) {
  const rows = groups.flatMap((g) => g.rows);
  const [selected, setSelected] = useState(0);
  const [touched, setTouched] = useState(false);
  useEffect(() => setSelected(0), [query]);
  const marked = touched || query.length > 0 ? Math.min(selected, rows.length - 1) : -1;

  const onKey = useRef<(e: React.KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (marked === -1) setTouched(true);
      else setSelected(Math.max(0, Math.min(rows.length - 1, marked + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && marked !== -1) {
      e.preventDefault();
      rows[marked]?.act();
    }
  };
  useEffect(() => {
    useNewTabStore.setState((s) => ({ keys: { ...s.keys, [panelId]: (e) => onKey.current(e) } }));
  }, [panelId]);

  let n = -1;
  return (
    <div role="listbox" aria-label="New tab" className="flex-1 min-h-0 overflow-y-auto px-3 pt-1 pb-4">
      {rows.length === 0 && query && <div className="px-2 py-1.5 text-[13px] text-text-tertiary">Nothing matches</div>}
      <div className="flex flex-col gap-3">
        {groups.map((group, g) => (
          <div key={group.title ?? g} className="flex flex-col">
            {group.title && (
              <div className="px-2 pb-1 flex items-center text-[12px] font-medium text-text-tertiary">
                {group.title}
                {group.aside && <span className="ml-auto flex">{group.aside}</span>}
              </div>
            )}
            {group.rows.map((row) => {
              n += 1;
              return <RowButton key={row.key} row={row} on={n === marked} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function RowButton({ row, on }: { row: Row; on: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [on]);
  return (
    <div
      ref={ref}
      className={`group/row relative h-8 flex items-center rounded-md transition-colors duration-100 ${
        on ? 'bg-ink/[0.07]' : 'hover:bg-ink/[0.05]'
      }`}
    >
      <button
        type="button"
        role="option"
        aria-selected={on}
        onClick={row.act}
        className={`flex-1 min-w-0 h-full flex items-center gap-2.5 px-2 border-none bg-transparent text-left text-[13px] ${
          row.quiet ? 'text-ink/45 hover:text-ink/75' : on ? 'text-ink/90' : 'text-ink/75'
        }`}
      >
        <Icon name={row.icon} className={`w-3.5 h-3.5 shrink-0 ${row.quiet ? '' : 'text-ink/50'}`} />
        <span className="shrink-0">{row.title}</span>
        {row.detail && <span className="min-w-0 truncate text-[12px] font-mono text-text-tertiary">{row.detail}</span>}
      </button>
      {row.edit && (
        <button
          type="button"
          aria-label={row.edit.label}
          onClick={row.edit.onClick}
          className="w-6 h-6 shrink-0 flex items-center justify-center rounded border-none bg-transparent text-ink/45 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-ink/85 hover:bg-ink/10 [&>svg]:w-3 [&>svg]:h-3"
        >
          <Icon name="pencil-simple" />
        </button>
      )}
      <Icon name="arrow-elbow-down-left" className={`w-3 h-3 shrink-0 mx-2 text-ink/35 ${on ? '' : 'hidden'}`} />
    </div>
  );
}
