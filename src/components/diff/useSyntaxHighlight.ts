import { useEffect, useState, useRef } from 'react';
import type { FileDiff } from '../../types';
import type { HunkTokens } from '../../utils/syntaxHighlight';

/**
 * Hook that tokenizes diff hunks for syntax highlighting.
 * Returns null while loading or if highlighting is unavailable.
 */
export function useSyntaxHighlight(diff: FileDiff | null, filePath: string): HunkTokens[] | null {
  const [tokens, setTokens] = useState<HunkTokens[] | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    setTokens(null);

    if (!diff || diff.hunks.length === 0) return;

    let cancelled = false;
    cancelRef.current = false;

    // Dynamic import to avoid blocking initial render with shiki's WASM load
    import('../../utils/syntaxHighlight').then(({ tokenizeDiffHunks }) => {
      if (cancelled) return;
      tokenizeDiffHunks(diff.hunks, filePath).then((result) => {
        if (!cancelled) setTokens(result);
      });
    });

    return () => {
      cancelled = true;
      cancelRef.current = true;
    };
  }, [diff, filePath]);

  return tokens;
}
