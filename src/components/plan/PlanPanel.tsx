import { useEffect, useState, useCallback, useRef } from 'react';
import { marked } from 'marked';
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

export function PlanPanel({ ptyId: _ptyId, planPath, onClose }: PlanPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

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

  // Syntax-highlight code blocks after render
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !content) return;

    let cancelled = false;

    async function highlightCodeBlocks() {
      const blocks = container!.querySelectorAll<HTMLElement>('pre code[class*="language-"]');
      if (blocks.length === 0) return;

      const hl = await getHighlighter();
      if (cancelled) return;

      for (const block of blocks) {
        const langClass = [...block.classList].find((c) => c.startsWith('language-'));
        const lang = langClass?.slice('language-'.length);
        if (!lang) continue;

        // Ensure language is loaded
        const loaded = hl.getLoadedLanguages();
        if (!loaded.includes(lang)) {
          if (lang in bundledLanguages) {
            try {
              await hl.loadLanguage(lang as BundledLanguage);
            } catch {
              continue;
            }
          } else {
            continue;
          }
        }
        if (cancelled) return;

        const code = block.textContent ?? '';
        const html = hl.codeToHtml(code, { lang, theme: THEME });

        // Replace the <pre> wrapper with shiki's highlighted output
        const pre = block.parentElement;
        if (pre?.tagName === 'PRE') {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = html;
          const shikiPre = wrapper.firstElementChild;
          if (shikiPre) {
            pre.replaceWith(shikiPre);
          }
        }
      }
    }

    highlightCodeBlocks();
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

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  const renderedHtml = content ? renderPlanMarkdown(content) : '';

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
      <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-4" onClick={handleClick}>
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

// ── Markdown rendering ────────────────────────────────────────────────

function renderPlanMarkdown(md: string): string {
  marked.setOptions({
    gfm: true,
    breaks: false,
  });
  return marked.parse(md) as string;
}
