import { useEffect, useState, useCallback } from 'react';
import { marked, type Tokens } from 'marked';
import { createHighlighter, bundledLanguages } from 'shiki';
import type { HighlighterGeneric } from '@shikijs/types';
import type { BundledLanguage } from 'shiki';
import { Icon } from '../terminal/Icon';
import { TooltipButton } from '../ui/TooltipButton';

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

let highlighterPromise: Promise<HighlighterGeneric<any, any>> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [THEME], langs: PRELOADED_LANGS });
  }
  return highlighterPromise;
}

// ── Markdown rendering with inline syntax highlighting ───────────────

async function renderPlanMarkdown(md: string): Promise<string> {
  const hl = await getHighlighter();

  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }: Tokens.Code) => {
    if (lang) {
      const loaded = hl.getLoadedLanguages();
      if (loaded.includes(lang) || lang in bundledLanguages) {
        try {
          if (!loaded.includes(lang)) {
            // Can't await in synchronous renderer — fall through to plain if not preloaded
          } else {
            return hl.codeToHtml(text, { lang, theme: THEME });
          }
        } catch {
          // Fall through to plain code block
        }
      }
    }
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code>${escaped}</code></pre>`;
  };

  return marked.parse(md, { gfm: true, renderer }) as string;
}

export function PlanPanel({ ptyId: _ptyId, planPath, onClose }: PlanPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const filename = planPath.split('/').pop() ?? 'plan.md';

  // Load initial content and start file watching
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const text = await window.api.plan.read(planPath);
      if (!cancelled) {
        setContent(text);
        setLoading(false);
      }
      await window.api.plan.watch(planPath);
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

  // Render markdown with syntax highlighting whenever content changes
  useEffect(() => {
    if (!content) {
      setRenderedHtml('');
      return;
    }

    let cancelled = false;
    renderPlanMarkdown(content).then((html) => {
      if (!cancelled) setRenderedHtml(html);
    });
    return () => {
      cancelled = true;
    };
  }, [content]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a[href]');
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute('href');
      if (href) window.api.openExternal(href);
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="list-checks" className="w-4 h-4 text-white/50 shrink-0" />
          <span className="font-mono text-xs font-medium text-white/70">Plan</span>
          <span className="font-mono text-[11px] text-white/40 truncate">{filename}</span>
        </div>
        <div className="flex items-center">
          <TooltipButton
            text={copied ? 'Copied!' : 'Copy to clipboard'}
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center bg-transparent border-none text-white/40 hover:text-white/90 transition-colors duration-150"
            onClick={handleCopy}
          >
            <Icon name={copied ? 'check' : 'clipboard-text'} className={`w-4 h-4 ${copied ? 'text-[#69db7c]' : ''}`} />
          </TooltipButton>
          <button
            className="w-7 h-7 flex items-center justify-center bg-transparent border-none text-white/40 hover:text-white/90 transition-colors duration-150"
            onClick={onClose}
          >
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4" onClick={handleClick}>
        {loading ? (
          <div className="text-sm text-white/40">Loading plan...</div>
        ) : content === null ? (
          <div className="text-sm text-white/40">Plan file not found</div>
        ) : (
          <div className="plan-markdown" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        )}
      </div>
    </div>
  );
}
