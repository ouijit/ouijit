import { useEffect, useState } from 'react';
import type { BundledLanguage } from 'shiki';
import { tokenizeCode, type ThemedToken } from '../../utils/syntaxHighlight';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

interface CodePreviewProps {
  code: string;
  lang: BundledLanguage | null;
  /** Names the code in a header, as a diff card names its file; without one, the code stands alone. */
  path?: string;
  lineNumbers?: boolean;
  /** Tailwind max-height for the scrolling body. */
  maxHeight?: string;
  testId?: string;
}

function dirname(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash < 0 ? '' : p.slice(0, slash + 1);
}

/** Read-only code, highlighted the way the diff is and drawn in a card like one of its files. */
export function CodePreview({
  code,
  lang,
  path,
  lineNumbers = true,
  maxHeight = 'max-h-60',
  testId,
}: CodePreviewProps) {
  const resolvedTheme = useResolvedTheme();
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    setTokens(null);
    if (!lang) return;
    let live = true;
    void tokenizeCode(code, lang).then((result) => live && setTokens(result));
    return () => {
      live = false;
    };
  }, [code, lang, resolvedTheme]);

  const lines = code.replace(/\n$/, '').split('\n');

  return (
    <div className="diff-card rounded-[10px] border border-bezel bg-diff-card overflow-clip" data-testid={testId}>
      {path && (
        <div className="pane-ledge flex items-center gap-2 px-3 h-8 bg-terminal-surface">
          <span className="flex-1 min-w-0 truncate font-mono text-xs" title={path}>
            <span className="text-ink/35">{dirname(path)}</span>
            <span className="text-ink/90">{path.slice(dirname(path).length)}</span>
          </span>
          {lang && <span className="shrink-0 text-[10px] text-text-tertiary">{lang}</span>}
        </div>
      )}
      <div className={`${maxHeight} overflow-auto py-1.5`}>
        {lines.map((line, i) => (
          <div key={i} className="flex font-mono text-xs leading-normal">
            {lineNumbers && (
              <span aria-hidden className="w-9 shrink-0 pr-2 text-right select-none text-ink/30">
                {i + 1}
              </span>
            )}
            <span data-code-line className="flex-1 min-w-0 px-3 whitespace-pre-wrap break-words text-text-primary">
              {tokens?.[i]
                ? tokens[i].map((token, j) => (
                    <span key={j} style={token.color ? { color: token.color } : undefined}>
                      {token.content}
                    </span>
                  ))
                : line}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
