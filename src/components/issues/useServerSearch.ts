import { useEffect, useRef, useState } from 'react';
import log from 'electron-log/renderer';
import { describeError } from '../../utils/describeError';

const searchLog = log.scope('search');

/** Long enough that typing a word is one request rather than one per key. */
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * What the tracker finds for `query`, beyond what is loaded. `results` is null
 * until a search has answered for the query on screen, so a stale answer is
 * never shown against a newer query. An empty query, or a single character,
 * searches nothing.
 */
export function useServerSearch<T>(
  query: string,
  search: ((query: string) => Promise<T>) | null,
): { results: T | null; searching: boolean } {
  const [answer, setAnswer] = useState<{ query: string; results: T } | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(search);
  searchRef.current = search;
  const enabled = search != null;

  const trimmed = query.trim();
  useEffect(() => {
    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const results = await searchRef.current!(trimmed);
          if (live) setAnswer({ query: trimmed, results });
        } catch (error) {
          searchLog.warn('search failed', { error: describeError(error) });
        } finally {
          if (live) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [trimmed, enabled]);

  return { results: enabled && answer?.query === trimmed ? answer.results : null, searching };
}
