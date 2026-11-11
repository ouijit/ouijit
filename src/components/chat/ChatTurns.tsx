import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { revealed, useReveal } from './useReveal';
import { Icon } from '../terminal/Icon';
import { StatusGlyph } from '../terminal/StatusDot';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatNodeView, ThoughtLine, foldSummary, formatSpan, isEmptyThought, type NodeContext } from './ChatNodes';
import type { AssistantMessageNode, ChatNode, UserMessageNode } from '../../chat/model';

type Piece = { kind: 'work'; nodes: ChatNode[] } | { kind: 'said'; node: AssistantMessageNode };

interface Turn {
  opener: UserMessageNode | null;
  body: ChatNode[];
  /** Shown whatever the turn's state: what stops for the user, and failures. */
  kept: ChatNode[];
}

const KEPT: ChatNode['kind'][] = ['request', 'notice', 'plan'];

function turnsOf(nodes: ChatNode[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const node of nodes) {
    if (node.kind === 'user_message') {
      current = { opener: node, body: [], kept: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { opener: null, body: [], kept: [] };
      turns.push(current);
    }
    if (KEPT.includes(node.kind)) current.kept.push(node);
    else if (!isEmptyThought(node)) current.body.push(node);
  }
  return turns;
}

function said(node: ChatNode): node is AssistantMessageNode {
  return node.kind === 'assistant_message' && node.text.trim() !== '';
}

/**
 * More than a remark on the way to the next step: a paragraph, a list, a
 * heading or code, or a few sentences. That is what the reader reads, so it
 * streams in where it was said; a remark only names the step.
 */
function substantial(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 220 || /\n\s*\n|\n\s*([-*]|\d+\.)\s|^#|```/m.test(trimmed);
}

/**
 * The turn as it reads: substantial messages where they were said, the work
 * between them folded to a line each, and a finished turn's last message kept
 * whatever its length.
 */
function piecesOf(body: ChatNode[], finished: boolean): Piece[] {
  const lastSaid = finished ? body.findLastIndex(said) : -1;
  const pieces: Piece[] = [];
  body.forEach((node, index) => {
    if (said(node) && (index === lastSaid || substantial(node.text))) {
      pieces.push({ kind: 'said', node });
      return;
    }
    const last = pieces.at(-1);
    if (last?.kind === 'work') last.nodes.push(node);
    else pieces.push({ kind: 'work', nodes: [node] });
  });
  return pieces;
}

function firstSentence(text: string): string {
  const sentence = text.trim().split(/(?<=[.!?])\s/)[0];
  return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence;
}

/**
 * What the agent is on now, from the latest thing that names it: a step, a
 * finished thought, or a remark. Something still streaming in is a few words
 * of a sentence, so it waits until it is whole; until then the last phrase stands.
 */
function doingNow(work: ChatNode[]): string | null {
  for (let i = work.length - 1; i >= 0; i--) {
    const node = work[i];
    if (node.kind === 'tool_call') return `${node.title.replace(/[.…]+$/, '')}…`;
    if ((node.kind === 'reasoning' || node.kind === 'assistant_message') && node.status !== 'running') {
      if (node.text.trim()) return firstSentence(node.text);
    }
  }
  return null;
}

/** Each phrase stays up long enough to read before the next replaces it; ones in between are skipped. */
const HOLD_MS = 2000;

function useHeld(phrase: string): string {
  const [shown, setShown] = useState(phrase);
  const since = useRef(Date.now());
  useEffect(() => {
    if (phrase === shown) return;
    const wait = Math.max(0, HOLD_MS - (Date.now() - since.current));
    const timer = setTimeout(() => {
      since.current = Date.now();
      setShown(phrase);
    }, wait);
    return () => clearTimeout(timer);
  }, [phrase, shown]);
  return shown;
}

function Doing({ work, started }: { work: ChatNode[]; started: number }) {
  const latest = useRef('Thinking…');
  latest.current = doingNow(work) ?? latest.current;
  const phrase = useHeld(latest.current);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className="flex items-center gap-2 min-h-[22px] text-[13px] text-text-tertiary"
      role="status"
      aria-label="Working"
    >
      <span className="w-3 flex justify-center shrink-0">
        <StatusGlyph status="thinking" size={8} />
      </span>
      <span className="flex-1 truncate">{phrase}</span>
      <span className="shrink-0 tabular-nums">{formatSpan(now - started)}</span>
    </div>
  );
}

function WorkFold({ work, context }: { work: ChatNode[]; context: NodeContext }) {
  const [open, setOpen] = useState(false);
  const span = formatSpan(Math.max(...work.map((n) => n.createdAt)) - work[0].createdAt);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="w-full min-h-[22px] flex items-center gap-2 text-left text-[13px] text-text-tertiary hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Icon name={open ? 'caret-down' : 'caret-right'} className="w-3 h-3 shrink-0" />
        <span className="flex-1 truncate">{foldSummary(work)}</span>
        {span && <span className="shrink-0 tabular-nums">{span}</span>}
      </button>
      {open && (
        <div className="pl-5 pb-2 flex flex-col gap-2">
          {work.map((node) =>
            node.kind === 'reasoning' ? (
              <ThoughtLine key={node.id} text={node.text.trim()} />
            ) : (
              <ChatNodeView key={node.id} node={node} context={context} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A wake, as what happened: what the user did as a line each, the rest as one caption. */
function WakeOpener({ node }: { node: UserMessageNode }) {
  if (!node.notes?.length) {
    return <div className="text-[13px] text-text-tertiary whitespace-pre-wrap break-words">{node.text}</div>;
  }
  const events = node.notes.filter((n) => n.kind === 'event').map((n) => n.text);
  return (
    <div className="flex flex-col gap-1 pt-1">
      {node.notes
        .filter((n) => n.kind === 'decision')
        .map((n, index) => (
          <div key={index} className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Icon name="check" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
            <span className="min-w-0 break-words">{n.text}</span>
          </div>
        ))}
      {events.length > 0 && <div className="text-[12px] text-text-tertiary break-words">{events.join(' · ')}</div>}
    </div>
  );
}

function Said({ node, paced, onDone }: { node: AssistantMessageNode; paced: boolean; onDone: (id: string) => void }) {
  const text = useReveal(node.text, paced);
  const done = node.status !== 'running' && revealed(text, node.text);
  useEffect(() => {
    if (done) onDone(node.id);
  }, [done, node.id, onDone]);
  return (
    <div className="chat-said-in">
      <ChatMarkdown text={text} complete={done} />
    </div>
  );
}

interface Layout {
  turn: Turn;
  pieces: Piece[];
  /** The line saying what it is on, from the work after the last thing said; null when there is none to show. */
  doing: ChatNode[] | null;
}

function layoutOf(turn: Turn, running: boolean): Layout {
  const pieces = piecesOf(turn.body, !running);
  if (!running) return { turn, pieces, doing: null };
  const tail = pieces.at(-1)?.kind === 'work' ? pieces.pop() : undefined;
  if (tail?.kind === 'work') return { turn, pieces, doing: tail.nodes };
  // Something being said shows itself happening; with nothing yet, the line says it is thinking.
  return { turn, pieces, doing: pieces.at(-1)?.kind === 'said' ? null : [] };
}

/**
 * A transcript a turn at a time. While a turn runs, a line says what it is
 * on, and what it says to the reader streams in where it is said; the steps
 * between fold to a line, and nothing shown is put away afterwards.
 *
 * What is said while it is open is revealed in order, one message at a time:
 * nothing after a message still being revealed shows until it has caught up,
 * so a later part never lands, or finishes, ahead of an earlier one.
 */
export function ChatTurns({
  nodes,
  context,
  busy,
  onHeld,
}: {
  nodes: ChatNode[];
  context: NodeContext;
  busy: boolean;
  /** Whether something said is still being revealed, so what comes after it waits. */
  onHeld?: (held: boolean) => void;
}) {
  // Whether each message is paced, decided the first time it is seen and kept:
  // only what first appears during a turn is arriving now. A conversation
  // opened, or its history re-sent as its agent resumes, shows whole.
  const pacedIds = useRef<Map<string, boolean> | null>(null);
  if (!pacedIds.current) {
    pacedIds.current = new Map(nodes.filter((n) => n.kind === 'assistant_message').map((n) => [n.id, false]));
  }
  const pacedFor = (id: string): boolean => {
    const known = pacedIds.current!.get(id);
    if (known !== undefined) return known;
    pacedIds.current!.set(id, busy);
    return busy;
  };
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set());
  const onDone = useCallback((id: string) => setRevealedIds((ids) => (ids.has(id) ? ids : new Set(ids).add(id))), []);
  const turns = turnsOf(nodes);
  const layouts = turns.map((turn, index) => layoutOf(turn, busy && index === turns.length - 1));
  const pending = (node: AssistantMessageNode) => pacedFor(node.id) && !revealedIds.has(node.id);

  let held = false;
  const shown = layouts.map(({ turn, pieces, doing }, index) => {
    if (held) return null;
    const items: ReactNode[] = [];
    if (turn.opener) {
      items.push(
        turn.opener.wake ? (
          <WakeOpener key={turn.opener.id} node={turn.opener} />
        ) : (
          <ChatNodeView key={turn.opener.id} node={turn.opener} context={context} />
        ),
      );
    }
    for (const piece of pieces) {
      if (piece.kind === 'work') {
        items.push(<WorkFold key={piece.nodes[0].id} work={piece.nodes} context={context} />);
        continue;
      }
      const paced = pacedFor(piece.node.id);
      items.push(<Said key={piece.node.id} node={piece.node} paced={paced} onDone={onDone} />);
      if (pending(piece.node)) {
        held = true;
        break;
      }
    }
    if (!held) {
      if (doing) {
        items.push(
          <Doing key="doing" work={doing} started={turn.opener?.createdAt ?? turn.body[0]?.createdAt ?? Date.now()} />,
        );
      }
      for (const node of turn.kept) items.push(<ChatNodeView key={node.id} node={node} context={context} />);
    }
    return (
      <div
        key={turn.opener?.id ?? turn.body[0]?.id ?? turn.kept[0]?.id ?? `turn-${index}`}
        className="flex flex-col gap-3"
      >
        {items}
      </div>
    );
  });
  useEffect(() => onHeld?.(held), [held, onHeld]);
  return <div className="chat-turns flex flex-col gap-5">{shown}</div>;
}

/** True while the transcript is still revealing something; what follows it, like a card, waits. */
export const RevealHeld = createContext(false);

/**
 * Of `keys`, the ones to show: everything once the transcript has caught up,
 * and, while it has not, only what was already showing, so nothing jumps
 * ahead of the words that lead to it and nothing shown is taken back.
 */
export function useRevealGate(keys: string[]): Set<string> {
  const held = useContext(RevealHeld);
  const shown = useRef(new Set<string>());
  const visible = new Set(held ? keys.filter((key) => shown.current.has(key)) : keys);
  useEffect(() => {
    for (const key of visible) shown.current.add(key);
  });
  return visible;
}
