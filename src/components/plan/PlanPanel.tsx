import { useEffect, useState, useCallback, useRef } from 'react';
import { renderPlanMarkdown } from '../../utils/renderPlanMarkdown';
import { terminalInstances } from '../terminal/terminalReact';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { TooltipButton } from '../ui/TooltipButton';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';

interface PlanPanelProps {
  ptyId: string;
  panelId: string;
  planPath: string;
  onChangePlanFile: (newPath: string) => void;
}

// ── File existence helpers ───────────────────────────────────────────

function applyFileExistence(container: HTMLElement, existence: Record<string, boolean>): void {
  const anchors = container.querySelectorAll<HTMLAnchorElement>('a[data-file-ref]');
  anchors.forEach((a) => {
    const ref = a.getAttribute('data-file-ref');
    if (ref && ref in existence) {
      a.setAttribute('data-file-exists', String(existence[ref]));
    }
  });
}

export function PlanPanel({ ptyId, planPath, onChangePlanFile }: PlanPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const renderGenRef = useRef(0);

  const filename = planPath.split('/').pop() ?? 'plan.md';

  // Load initial content and start file watching
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Start watching first so no changes are missed between read and watch
      await window.api.plan.watch(planPath);
      if (cancelled) {
        // Component unmounted while awaiting — clean up the watcher we just created
        window.api.plan.unwatch(planPath);
        return;
      }
      const text = await window.api.plan.read(planPath);
      if (!cancelled) {
        setContent(text);
        setLoading(false);
      }
    }

    init();

    const cleanup = window.api.plan.onContentChanged((changedPath, newContent) => {
      if (changedPath === planPath && !cancelled) {
        setContent(newContent);
      }
    });

    return () => {
      cancelled = true;
      cleanup();
      window.api.plan.unwatch(planPath);
    };
  }, [planPath]);

  const contentRef = useRef<HTMLDivElement>(null);

  // Render markdown with syntax highlighting whenever content changes (debounced)
  useEffect(() => {
    if (!content) {
      setRenderedHtml('');
      return;
    }

    const generation = ++renderGenRef.current;
    const timer = setTimeout(() => {
      renderPlanMarkdown(content).then((html) => {
        if (renderGenRef.current !== generation) return;
        // Preserve scroll position across innerHTML replacement
        const scrollEl = contentRef.current?.parentElement;
        const scrollTop = scrollEl?.scrollTop ?? 0;
        setRenderedHtml(html);
        if (scrollEl) {
          requestAnimationFrame(() => {
            scrollEl.scrollTop = scrollTop;
          });
        }
      });
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [content]);

  // Fetch file existence when rendered HTML changes, cache results for re-application
  const fileExistenceRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const inst = terminalInstances.get(ptyId);
    if (!inst) return;
    const workspaceRoot = inst.worktreePath || inst.projectPath;

    const anchors = container.querySelectorAll<HTMLAnchorElement>('a[data-file-ref]');
    if (anchors.length === 0) return;

    const pathSet = new Set<string>();
    anchors.forEach((a) => {
      const ref = a.getAttribute('data-file-ref');
      if (ref) pathSet.add(ref);
    });

    let cancelled = false;

    // Apply cached results immediately (covers innerHTML replacements with same content)
    if (Object.keys(fileExistenceRef.current).length > 0) {
      applyFileExistence(container, fileExistenceRef.current);
    }

    // Fetch fresh results in background
    window.api.plan.checkFilesExist(workspaceRoot, Array.from(pathSet)).then((results) => {
      if (cancelled) return;
      fileExistenceRef.current = results;
      applyFileExistence(container, results);
    });

    return () => {
      cancelled = true;
    };
  }, [renderedHtml, ptyId]);

  const [editorHookDialog, setEditorHookDialog] = useState(false);
  const pendingFileRef = useRef<{ filePath: string; line?: number } | null>(null);

  const openFile = useCallback(
    (filePath: string, line?: number) => {
      const inst = terminalInstances.get(ptyId);
      if (!inst) return;
      const workspaceRoot = inst.worktreePath || inst.projectPath;
      window.api.openFileInEditor(inst.projectPath, workspaceRoot, filePath, line).then((result) => {
        if (!result.success) {
          if (result.error === 'no-editor') {
            pendingFileRef.current = { filePath, line };
            setEditorHookDialog(true);
          } else if (result.error) {
            useProjectStore.getState().addToast(result.error, 'error');
          }
        }
      });
    },
    [ptyId],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a[href]');
      if (!anchor) return;

      e.preventDefault();

      // File reference click — open in editor (skip if file doesn't exist)
      const fileRef = anchor.getAttribute('data-file-ref');
      if (fileRef) {
        if (anchor.getAttribute('data-file-exists') === 'false') return;
        const line = anchor.getAttribute('data-line');
        openFile(fileRef, line ? parseInt(line, 10) : undefined);
        return;
      }

      // External link (existing behavior)
      const href = anchor.getAttribute('href');
      if (href && href !== '#') window.api.openExternal(href);
    },
    [openFile],
  );

  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-white/10 shrink-0">
        <Icon name="list-checks" className="w-3.5 h-3.5 text-white/50 shrink-0" />
        <button
          className="text-[13px] text-white/50 truncate flex-1 font-mono bg-transparent border-none p-0 text-left transition-colors duration-150 hover:text-white/80"
          title={planPath}
          onClick={async () => {
            const inst = terminalInstances.get(ptyId);
            const defaultDir = inst?.worktreePath || inst?.projectPath;
            const result = await window.api.plan.pickFile(defaultDir);
            if (!result.canceled && result.filePath) {
              onChangePlanFile(result.filePath);
            }
          }}
        >
          {filename}
        </button>
        <TooltipButton
          text={copied ? 'Copied!' : 'Copy to clipboard'}
          placement="bottom"
          className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/40 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
          onClick={handleCopy}
        >
          <Icon name={copied ? 'check' : 'clipboard-text'} className={copied ? 'text-[#69db7c]' : ''} />
        </TooltipButton>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4" onClick={handleClick}>
        {loading ? (
          <div className="text-sm text-white/40">Loading plan...</div>
        ) : content === null ? (
          <div className="text-sm text-white/40">Plan file not found</div>
        ) : (
          <div ref={contentRef} className="plan-markdown" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        )}
      </div>
      {editorHookDialog && (
        <HookConfigDialog
          projectPath={terminalInstances.get(ptyId)?.projectPath ?? ''}
          hookType="editor"
          onClose={(result) => {
            setEditorHookDialog(false);
            if (result?.saved && pendingFileRef.current) {
              // Retry the file open now that an editor is configured
              const { filePath, line } = pendingFileRef.current;
              pendingFileRef.current = null;
              openFile(filePath, line);
            }
          }}
        />
      )}
    </div>
  );
}
