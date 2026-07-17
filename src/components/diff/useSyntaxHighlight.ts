import { useEffect, useState, useRef } from 'react';
import type { FileDiff } from '../../types';
import { tokenizeDiffHunks, type HunkTokens } from '../../utils/syntaxHighlight';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

/**
 * Hook that tokenizes diff hunks for syntax highlighting.
 * Returns null while loading or if highlighting is unavailable.
 */
export function useSyntaxHighlight(diff: FileDiff | null, filePath: string): HunkTokens[] | null {
  const [tokens, setTokens] = useState<HunkTokens[] | null>(null);
  // Tokenization reads the resolved theme; re-tokenize when it changes.
  const resolvedTheme = useResolvedTheme();
  // Tokens per theme for the current diff, so flipping themes back and forth
  // (e.g. sweeping the theme dropdown's hover preview) reuses earlier passes
  // instead of re-tokenizing the whole diff each flip.
  const cacheRef = useRef<{ diff: FileDiff | null; filePath: string; byTheme: Map<string, HunkTokens[]> }>({
    diff: null,
    filePath: '',
    byTheme: new Map(),
  });

  useEffect(() => {
    const cache = cacheRef.current;
    if (cache.diff !== diff || cache.filePath !== filePath) {
      cache.diff = diff;
      cache.filePath = filePath;
      cache.byTheme.clear();
    }

    const cached = cache.byTheme.get(resolvedTheme);
    if (cached) {
      setTokens(cached);
      return;
    }

    setTokens(null);
    if (!diff || diff.hunks.length === 0) return;

    let cancelled = false;

    // The highlighter itself loads lazily inside tokenizeDiffHunks, so the
    // first call absorbs shiki's WASM setup; later calls are pure CPU.
    void tokenizeDiffHunks(diff.hunks, filePath).then((result) => {
      if (cancelled) return;
      cache.byTheme.set(resolvedTheme, result);
      setTokens(result);
    });

    return () => {
      cancelled = true;
    };
  }, [diff, filePath, resolvedTheme]);

  return tokens;
}
