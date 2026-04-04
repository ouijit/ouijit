import { useEffect, useState, useCallback, useRef } from 'react';
import { marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { createHighlighter } from 'shiki';
import type { BundledLanguage } from 'shiki';
import { terminalInstances } from '../terminal/terminalReact';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { TooltipButton } from '../ui/TooltipButton';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';

interface PlanPanelProps {
  ptyId: string;
  planPath: string;
  onClose: () => void;
}

// ── Shiki highlighter (shared singleton) ─────────────────────────────

const THEME = 'github-dark';

const PRELOADED_LANGS: BundledLanguage[] = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'css',
  'html',
  'markdown',
  'python',
  'rust',
  'go',
  'yaml',
  'toml',
  'bash',
  'sql',
  'ruby',
  'swift',
  'c',
  'cpp',
  'java',
  'diff',
];

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [THEME], langs: PRELOADED_LANGS }).catch((err) => {
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

// ── File path linkification ──────────────────────────────────────────

const TAG_RE = /<\/?[^>]+>/g;
// Matches file paths with at least one "/" and a file extension, plus optional :line or :line-line suffix.
// Negative lookbehind prevents matching inside URLs or longer dot-separated paths.
const FILE_RE = /(?<![\/\w.])(?:\.\/)?([a-zA-Z_][\w.\-]*(?:\/[\w.\-]+)+\.\w{1,10})(?::(\d+)(?:-(\d+))?)?/g;

/**
 * Wraps file-path-like text in HTML with clickable anchors.
 * Operates on raw HTML — only modifies text outside of tags and existing <a> elements.
 */
export function linkifyFilePaths(html: string): string {
  let result = '';
  let lastIndex = 0;
  let insideAnchor = false;

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(html)) !== null) {
    const textSegment = html.slice(lastIndex, match.index);
    result += insideAnchor ? textSegment : linkifyText(textSegment);

    const tag = match[0];
    if (/<a[\s>]/i.test(tag)) insideAnchor = true;
    if (/<\/a>/i.test(tag)) insideAnchor = false;
    result += tag;
    lastIndex = match.index + match[0].length;
  }

  const remaining = html.slice(lastIndex);
  result += insideAnchor ? remaining : linkifyText(remaining);
  return result;
}

function linkifyText(text: string): string {
  if (!text) return text;
  return text.replace(FILE_RE, (full, filePath: string, line?: string, endLine?: string) => {
    const attrs = [
      `data-file-ref="${filePath}"`,
      line ? `data-line="${line}"` : '',
      endLine ? `data-end-line="${endLine}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<a href="#" ${attrs} class="file-ref">${full}</a>`;
  });
}

// ── Markdown rendering with inline syntax highlighting ───────────────

async function renderPlanMarkdown(md: string): Promise<string> {
  const hl = await getHighlighter();

  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }: Tokens.Code) => {
    if (lang && hl.getLoadedLanguages().includes(lang)) {
      try {
        return hl.codeToHtml(text, { lang, theme: THEME });
      } catch {
        // Fall through to plain code block
      }
    }
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code>${escaped}</code></pre>`;
  };

  const rawHtml = marked.parse(md, { gfm: true, renderer }) as string;
  const linkedHtml = linkifyFilePaths(rawHtml);
  return DOMPurify.sanitize(linkedHtml);
}

export function PlanPanel({ ptyId, planPath, onClose }: PlanPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const instance = terminalInstances.get(ptyId);
  const [fullWidth, setFullWidth] = useState(instance?.planFullWidth ?? true);
  const [splitRatio, setSplitRatio] = useState(instance?.planSplitRatio ?? 0.5);

  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

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

    let cancelled = false;
    const timer = setTimeout(() => {
      renderPlanMarkdown(content).then((html) => {
        if (cancelled) return;
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
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content]);

  // Check file existence after markdown renders
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

    window.api.plan.checkFilesExist(workspaceRoot, Array.from(pathSet)).then((results) => {
      if (cancelled) return;
      anchors.forEach((a) => {
        const ref = a.getAttribute('data-file-ref');
        if (ref && ref in results) {
          a.setAttribute('data-file-exists', String(results[ref]));
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [renderedHtml, ptyId]);

  // Toggle full-width vs split
  const toggleFullWidth = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!instance) return;
      const newFullWidth = !fullWidth;
      instance.planFullWidth = newFullWidth;
      setFullWidth(newFullWidth);
      instance.pushDisplayState({ planFullWidth: newFullWidth });

      requestAnimationFrame(() => {
        if (!newFullWidth) instance.fit();
      });
    },
    [fullWidth, instance],
  );

  // Resize handle drag
  useEffect(() => {
    const handle = handleRef.current;
    const panel = panelRef.current;
    if (!handle || !panel || !instance) return;

    const cardBody = panel.parentElement;
    if (!cardBody) return;

    let dragging = false;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      panel.style.transition = 'none';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = cardBody.getBoundingClientRect();
      const handleWidth = handle.offsetWidth;
      const totalWidth = rect.width - handleWidth;
      const mouseX = e.clientX - rect.left;
      let ratio = 1 - mouseX / totalWidth;
      ratio = Math.max(0.15, Math.min(0.85, ratio));
      instance.planSplitRatio = ratio;
      setSplitRatio(ratio);
      panel.style.flexBasis = `${ratio * 100}%`;
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Reset body styles in case we unmounted mid-drag
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [instance, fullWidth]);

  // Set initial flex-basis
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    if (fullWidth) {
      panel.style.flexBasis = '100%';
    } else {
      panel.style.flexBasis = `${splitRatio * 100}%`;
    }

    requestAnimationFrame(() => {
      if (!fullWidth) instance?.fit();
    });
  }, [fullWidth, splitRatio, instance]);

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

  const splitIcon = fullWidth ? 'square-split-horizontal' : 'arrows-out-line-horizontal';
  const splitTitle = fullWidth ? 'Split view' : 'Full width';

  return (
    <>
      {!fullWidth && (
        <div
          ref={handleRef}
          className="shrink-0 relative hover:bg-white/15 active:bg-white/15 after:content-[''] after:absolute after:top-0 after:bottom-0 after:-left-2 after:-right-2"
          style={{ width: 4, cursor: 'col-resize', background: 'transparent', transition: 'background 0.15s ease' }}
        />
      )}
      <div
        ref={panelRef}
        className="rounded-none border-0 border-l border-t border-solid border-white/10 shadow-none flex flex-col overflow-hidden"
        style={{
          flexBasis: 0,
          background: 'var(--color-terminal-bg, #171717)',
          transition: 'flex-basis 0.25s ease',
          ...(fullWidth ? { flex: '1 0 100%', borderLeft: 'none' } : { minWidth: 200 }),
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-white/10 shrink-0">
          <Icon name="list-checks" className="w-3.5 h-3.5 text-white/50 shrink-0" />
          <span className="text-[13px] text-white/50 truncate flex-1 font-mono">{filename}</span>
          <TooltipButton
            text={copied ? 'Copied!' : 'Copy to clipboard'}
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/40 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
            onClick={handleCopy}
          >
            <Icon name={copied ? 'check' : 'clipboard-text'} className={copied ? 'text-[#69db7c]' : ''} />
          </TooltipButton>
          <TooltipButton
            text={splitTitle}
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
            onClick={toggleFullWidth}
          >
            <Icon name={splitIcon} />
          </TooltipButton>
          <TooltipButton
            text="Minimize"
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-4 [&>svg]:h-4"
            onClick={onClose}
          >
            <Icon name="minus" />
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
    </>
  );
}
