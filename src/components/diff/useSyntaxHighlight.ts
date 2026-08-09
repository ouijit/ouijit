import { useEffect, useState } from 'react';
import type { FileDiff } from '../../types';
import { peekDiffTokens, tokenizeDiffHunks, type HunkTokens } from '../../utils/syntaxHighlight';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

/**
 * Hook that tokenizes diff hunks for syntax highlighting.
 * Returns null while loading or if highlighting is unavailable.
 *
 * The cache this reads lives in `syntaxHighlight.ts`, keyed on the hunk objects
 * themselves rather than here on the component — one file rendered in three
 * parts of a reading order is one tokenization, not three, and a file scrolled
 * back to is already done.
 */
export function useSyntaxHighlight(diff: FileDiff | null | undefined, filePath: string): HunkTokens[] | null {
  // Tokenization reads the resolved theme; re-tokenize when it changes.
  const resolvedTheme = useResolvedTheme();
  const hunks = diff?.hunks;

  // Start from whatever is already known, so a re-render of an unchanged file
  // never flashes plain text on its way back to the same tokens.
  const [tokens, setTokens] = useState<HunkTokens[] | null>(() => (hunks ? peekDiffTokens(hunks, filePath) : null));

  useEffect(() => {
    if (!hunks || hunks.length === 0) {
      setTokens(null);
      return;
    }

    const known = peekDiffTokens(hunks, filePath);
    if (known) {
      setTokens(known);
      return;
    }

    setTokens(null);
    let cancelled = false;

    // The highlighter itself loads lazily inside tokenizeDiffHunks, so the
    // first call absorbs shiki's WASM setup; later calls are pure CPU.
    void tokenizeDiffHunks(hunks, filePath).then((result) => {
      if (!cancelled) setTokens(result);
    });

    return () => {
      cancelled = true;
    };
  }, [hunks, filePath, resolvedTheme]);

  return tokens;
}
