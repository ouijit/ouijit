import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffBases } from '../../types';
import { UNCOMMITTED_BASE, describeDiffComparison, isUncommittedBase } from '../../diffSource';
import { MenuPopover, MenuItem, MenuDivider } from '../ui/Menu';
import { Tooltip } from '../ui/Tooltip';
import { SegmentedGroup, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';
import { Icon } from '../terminal/Icon';
import { formatAge } from '../../utils/formatDate';
import { groupDiffBases, searchDiffBases, MAX_BASE_ROWS, type DiffBaseRow } from './diffBaseGroups';
import { terminalInstances, refreshTerminalGitStatus } from '../terminal/terminalReact';

interface DiffComparisonPickerProps {
  ptyId: string;
  /** The worktree the diff is of — where the refs are read and fetched. */
  gitPath: string;
  /** The ref the diff is currently taken against. */
  base: string | null;
  /** What this branch merges into, which is the base until something else is picked. */
  defaultBase: string | null;
  mainBranch: string | null;
  /** The branch the diff is of, which cannot also be what it is compared to. */
  branch: string | null;
}

const NO_BASES: DiffBases = { refs: [], upstream: null, defaultRemote: null, lastFetch: null };

/**
 * What the panel is comparing, and the way to change it.
 *
 * Every entry answers the same question — what does this worktree have that the
 * chosen ref does not — so the uncommitted changes are one of the refs on offer
 * rather than a mode beside them.
 *
 * A remote-tracking ref is only as current as the last fetch, so choosing one
 * fetches it, and a base that is one carries how long ago that was beside it.
 */
export function DiffComparisonPicker({
  ptyId,
  gitPath,
  base,
  defaultBase,
  mainBranch,
  branch,
}: DiffComparisonPickerProps) {
  const [open, setOpen] = useState(false);
  const [bases, setBases] = useState<DiffBases>(NO_BASES);
  const [fetching, setFetching] = useState(false);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Read while the panel is showing rather than only while the menu is open:
  // whether the base is a remote-tracking ref, and how old it is, is part of
  // the header. Four git subprocesses, on a panel the reader opened.
  useEffect(() => {
    let live = true;
    void window.api.listDiffBases(gitPath).then((next) => live && setBases(next));
    return () => {
      live = false;
    };
  }, [gitPath, open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const groups = useMemo(
    () => groupDiffBases(bases, { branch, base: defaultBase, mainBranch }),
    [bases, branch, defaultBase, mainBranch],
  );
  const matches = useMemo(() => (query ? searchDiffBases(bases.refs, query, branch) : []), [bases.refs, query, branch]);

  const isRemote = (ref: string | null) => bases.refs.some((r) => r.ref === ref && r.remote !== null);
  const uncommitted = isUncommittedBase(base, branch);

  const fetchBase = useCallback(
    async (ref: string) => {
      setFetching(true);
      await window.api.fetchDiffBase(gitPath, ref);
      const instance = terminalInstances.get(ptyId);
      if (instance) await refreshTerminalGitStatus(instance);
      setBases(await window.api.listDiffBases(gitPath));
      setFetching(false);
    },
    [gitPath, ptyId],
  );

  const choose = useCallback(
    (nextBase: string) => {
      setOpen(false);
      terminalInstances.get(ptyId)?.setDiffBase(nextBase);
      if (isRemote(nextBase)) void fetchBase(nextBase);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isRemote reads the same `bases` the deps carry
    [bases.refs, fetchBase, ptyId],
  );

  /** Arrow keys walk the rows, from the field as well as from within them. */
  const walkRows = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
  };

  const row = ({ ref, hint }: DiffBaseRow) => (
    <MenuItem key={ref} label={ref} hint={hint} selected={ref === base} onClick={() => choose(ref)} />
  );

  const overflow = (count: number, filtered: boolean) => (
    <div className="px-2.5 py-1.5 text-[11px] text-text-tertiary">
      +{count} more{filtered ? ' matching' : ' — type to filter'}
    </div>
  );

  /**
   * How current a remote base is, and the way to make it current.
   *
   * A remote-tracking ref is a local file that only moves when something
   * fetches, so a comparison against one is a comparison against whatever was
   * last pulled down — and nothing in the diff itself says how long ago that
   * was.
   */
  const since = bases.lastFetch === null ? null : (Date.now() - bases.lastFetch) / 1000;
  // `formatAge` reads as `now` under a minute, which is the right register for
  // a branch age in a list and the wrong one for a label standing on its own.
  const age = since === null ? 'never' : since < 60 ? 'just now' : formatAge(since);
  const fetched = since === null ? 'never fetched' : since < 60 ? 'fetched just now' : `fetched ${age} ago`;

  const freshness = isRemote(base) && (
    <Tooltip text={`Fetch ${base} — ${fetched}`} referenceClassName="shrink-0 inline-flex">
      <button
        type="button"
        aria-label={`Fetch ${base}`}
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors duration-150 disabled:opacity-60"
        disabled={fetching}
        onClick={() => base && void fetchBase(base)}
      >
        {/* The age stands while a fetch is in flight, since it is still the
            answer until that one lands — the glyph is what says it is moving. */}
        <Icon name="arrows-clockwise" className={`w-3 h-3 ${fetching ? 'animate-spin' : ''}`} />
        {age}
      </button>
    </Tooltip>
  );

  return (
    <>
      <MenuPopover
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        className="w-72 max-h-[26rem]"
        trigger={(triggerRef) => (
          <SegmentedGroup>
            <button
              ref={triggerRef}
              type="button"
              className={`${segmentBase} ${open ? 'bg-background-tertiary text-text-primary' : segmentQuiet}`}
              onClick={() => setOpen(!open)}
            >
              <span className="truncate max-w-[16rem]">{describeDiffComparison(base, branch)}</span>
              <Icon name="caret-down" className="w-3 h-3 shrink-0" />
            </button>
          </SegmentedGroup>
        )}
        header={
          <label className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] bg-ink/[0.05] focus-within:bg-ink/[0.08] transition-colors duration-150">
            <Icon name="magnifying-glass" className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape clears the search it belongs to; only with nothing left
                // to clear does it fall through to closing the menu.
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
                if (e.key === 'Enter' && matches.length > 0) choose(matches[0].ref);
                walkRows(e);
              }}
              placeholder="Find a branch"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
            />
          </label>
        }
      >
        <div ref={listRef} onKeyDown={walkRows}>
          {query ? (
            <>
              {matches.slice(0, MAX_BASE_ROWS).map(row)}
              {matches.length > MAX_BASE_ROWS && overflow(matches.length - MAX_BASE_ROWS, true)}
              {matches.length === 0 && (
                <div className="px-2.5 py-1.5 text-sm text-text-tertiary">No branch matches</div>
              )}
            </>
          ) : (
            <>
              <MenuItem
                label="Uncommitted changes"
                hint="your last commit"
                selected={uncommitted}
                onClick={() => choose(UNCOMMITTED_BASE)}
              />
              {groups.roles.length > 0 && <MenuDivider />}
              {groups.roles.map(row)}
              {groups.rest.length > 0 && <MenuDivider />}
              {groups.rest.length > 0 && (
                <div className="px-2.5 pt-1 pb-1.5 text-[11px] uppercase tracking-wide text-text-tertiary">
                  All branches
                </div>
              )}
              {groups.rest.map(row)}
              {groups.hidden > 0 && overflow(groups.hidden, false)}
            </>
          )}
        </div>
      </MenuPopover>
      {freshness}
    </>
  );
}
