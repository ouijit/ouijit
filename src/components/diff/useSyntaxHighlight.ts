import { useEffect, useState } from 'react';
import type { FileDiff } from '../../types';
import { peekDiffTokens, tokenizeDiffHunks, type HunkTokens } from '../../utils/syntaxHighlight';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

/**
 * Tokenizes diff hunks, returning null while loading or when highlighting is
 * unavailable. The cache lives in `syntaxHighlight.ts` keyed on the hunk
 * objects, not here, so a file rendered twice is tokenized once.
 */
export function useSyntaxHighlight(diff: FileDiff | null | undefined, filePath: string): HunkTokens[] | null {
  // Tokenization reads the resolved theme; re-tokenize when it changes.
  const resolvedTheme = useResolvedTheme();
  const hunks = diff?.hunks;

  // Start from what is already cached, or an unchanged file flashes plain text
  // on its way back to the same tokens.
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

    // The first call absorbs shiki's lazy WASM setup; later calls are pure CPU.
    void tokenizeDiffHunks(hunks, filePath).then((result) => {
      if (!cancelled) setTokens(result);
    });

    return () => {
      cancelled = true;
    };
  }, [hunks, filePath, resolvedTheme]);

  return tokens;
}
