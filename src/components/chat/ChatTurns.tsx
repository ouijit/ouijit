import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { closeOpenMarkup, revealed, useReveal } from './useReveal';
import { relativeToCard } from './cardPaths';
import { Icon } from '../terminal/Icon';
import { StatusGlyph } from '../terminal/StatusDot';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatNodeList, ChatNodeView, Span, foldSummary, isEmptyThought, useNow, type NodeContext } from './ChatNodes';
import { ChatRequestView, SettledLine, allowed, approvedByChat, firstLine, settledLabel } from './ChatRequest';
import type {
  AssistantMessageNode,
  ChatNode,
  NoticeNode,
  ToolCallNode,
  UserMessageNode,
  WakeNote,
  WakeRequest,
} from '../../chat/model';

type Piece =
  | { kind: 'work'; nodes: ChatNode[] }
  | { kind: 'said'; node: AssistantMessageNode }
  | { kind: 'endings'; nodes: NoticeNode[] };

interface Turn {
  opener: UserMessageNode | null;
  body: ChatNode[];
  /** Shown whatever the turn's state: what stops for the user, and failures. */
  kept: ChatNode[];
}

const KEPT: ChatNode['kind'][] = ['request', 'notice', 'plan'];

function isEnding(node: ChatNode): node is NoticeNode {
  return node.kind === 'notice' && Boolean(node.ended);
}

function turnsOf(nodes: ChatNode[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const node of nodes) {
    if (node.kind === 'user_message') {
      current = { opener: node, body: [], kept: [] };
      turns.push(current);
      continue;
    }
    if (node.kind === 'compaction') {
      turns.push({ opener: null, body: [], kept: [node] });
      current = null;
      continue;
    }
    if (!current) {
      current = { opener: null, body: [], kept: [] };
      turns.push(current);
    }
    // An allowed request leaves nothing to show: the step it gated is in the turn's work.
    if (node.kind === 'request' && allowed(node)) continue;
    if (KEPT.includes(node.kind) && !isEnding(node)) current.kept.push(node);
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
    // Unlike the turn's other notices, background work ending shows where it happened, not after the turn.
    if (isEnding(node)) {
      if (last?.kind === 'endings') last.nodes.push(node);
      else pieces.push({ kind: 'endings', nodes: [node] });
    } else if (last?.kind === 'work') last.nodes.push(node);
    else pieces.push({ kind: 'work', nodes: [node] });
  });
  return pieces;
}

function firstSentence(text: string): string {
  const sentence = text.trim().split(/(?<=[.!?])\s/)[0];
  return sentence;
}

/**
 * A step as the line names it: what the agent said it does, never a raw
 * command, and a file it reads or edits by name alone.
 */
function stepPhrase(node: ToolCallNode, cardId: string): string {
  if (node.tool === 'command' && (!node.title || node.title === node.command)) return 'Running a command';
  const title = relativeToCard(node.title, cardId).replace(/[.…]+$/, '');
  if (node.tool !== 'read' && node.tool !== 'edit') return title;
  return title.replace(/\S*\/(\S+)/g, (path, name: string) => (path.includes('://') ? path : name));
}

/** Longer than this, a remark is a paragraph's opening rather than a name for what is happening. */
const REMARK_CHARS = 60;

/**
 * What the agent is on now: the latest step, or a short remark it made on the
 * way to the next one. A thought is the agent's own working, too long to read
 * as a line and not meant as a report, so it is Thinking, as is a remark that
 * runs on. Something still streaming waits until it is whole.
 */
function doingNow(work: ChatNode[], cardId: string): { phrase: string; since: number } | null {
  for (let i = work.length - 1; i >= 0; i--) {
    const node = work[i];
    if (node.kind === 'tool_call') return { phrase: stepPhrase(node, cardId), since: node.createdAt };
    if (node.kind === 'reasoning') return { phrase: 'Thinking', since: node.createdAt };
    if (node.kind === 'assistant_message' && node.status !== 'running' && node.text.trim()) {
      const remark = firstSentence(node.text);
      return { phrase: remark.length <= REMARK_CHARS ? remark : 'Thinking', since: node.createdAt };
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

/** What a turn still running is on: the phrase its line says, and when that began. */
interface Live {
  /** When the turn began, for the total an opened line shows. */
  started: number;
  stopping: boolean;
  /** Said in place of what the work shows. */
  what?: string;
}

/**
 * The work between two things said, as one line. While the turn runs, the line
 * says what it is on now and for how long; opened, it shows every step so far
 * under the turn's total, and stays open as the turn ends and it becomes the
 * fold, so nothing moves under the reader.
 */
function WorkFold({ work, context, live }: { work: ChatNode[]; context: NodeContext; live?: Live }) {
  const [open, setOpen] = useState(false);
  const now = useNow(Boolean(live));
  const latest = useRef<{ phrase: string; since: number }>({ phrase: 'Thinking', since: live?.started ?? 0 });
  const doing = live && (live.what ? { phrase: live.what, since: live.started } : doingNow(work, context.cardId));
  if (doing && doing.phrase !== latest.current.phrase) latest.current = doing;
  const held = useHeld(latest.current.phrase);
  const since = useRef(new Map<string, number>());
  since.current.set(latest.current.phrase, latest.current.since);
  const expandable = work.length > 0;
  const expanded = open && expandable;

  let summary: ReactNode;
  if (live && !expanded) {
    summary = (
      <>
        <span className="w-3 flex justify-center shrink-0">
          {!live.stopping && <StatusGlyph status="thinking" size={8} />}
        </span>
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{live.stopping ? 'Stopping' : held}</span>
        <Span ms={now - (since.current.get(held) ?? live.started)} />
      </>
    );
  } else {
    const end = Math.max(...work.map((n) => ('endedAt' in n && n.endedAt) || n.createdAt));
    summary = (
      <>
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="w-3 h-3 shrink-0" />
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{foldSummary(work)}</span>
        <Span ms={live ? now - live.started : end - work[0].createdAt} />
      </>
    );
  }

  return (
    <div className="flex flex-col" {...(live && { role: 'status', 'aria-label': 'Working' })}>
      <button
        type="button"
        className="w-full min-h-[22px] flex items-center gap-2 text-left text-[13px] text-text-tertiary enabled:hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen(!open)}
        disabled={!expandable}
        aria-expanded={expanded}
      >
        {summary}
      </button>
      {expanded && (
        <FoldBody>
          <ChatNodeList nodes={work} context={context} thoughtsAsText />
        </FoldBody>
      )}
    </div>
  );
}

/** How much more of an opened fold each step shows. */
const FOLD_STEP_PX = 480;
const FOLD_FADE = 'linear-gradient(to bottom, black calc(100% - 64px), transparent)';

/**
 * An opened fold, shown a screenful at a time: past its height it fades out,
 * and Show more lets the rest down a step at a time.
 */
function FoldBody({ children }: { children: ReactNode }) {
  const [limit, setLimit] = useState(FOLD_STEP_PX);
  const [height, setHeight] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setHeight(element.scrollHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const clipped = height > limit;
  return (
    <div className="pl-5 pb-2 flex flex-col">
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-out"
        style={{
          maxHeight: limit,
          ...(clipped && { maskImage: FOLD_FADE, WebkitMaskImage: FOLD_FADE }),
        }}
      >
        <div ref={content} className="flex flex-col gap-2">
          {children}
        </div>
      </div>
      {clipped && (
        <button
          type="button"
          className="self-start mt-1 text-[13px] text-text-tertiary hover:text-text-primary transition-colors duration-100"
          onClick={() => setLimit(limit + FOLD_STEP_PX)}
        >
          Show more
        </button>
      )}
    </div>
  );
}

/** A worker's request as one line: who wants what, how it was settled, the request in full behind it. */
function RequestLine({ note, request }: { note: WakeNote; request: WakeRequest }) {
  return (
    <SettledLine
      summary={
        request.step
          ? `${request.name}: ${request.step}`
          : request.command
            ? `${request.name} wants to run ${firstLine(request.command)}`
            : note.text
      }
      label={settledLabel(request.node)}
      command={request.command}
      detail={[request.node.title, request.node.detail].filter(Boolean).join('\n\n')}
    />
  );
}

/**
 * A wake, as what happened: what the user did as a line each, a worker's
 * request as a line of its own, and the rest as one caption. A request Chat
 * left waiting once its turn is over is the user's, shown in full to answer.
 */
function WakeOpener({ node, settled }: { node: UserMessageNode; settled: boolean }) {
  if (!node.notes?.length) {
    return <div className="text-[13px] text-text-tertiary whitespace-pre-wrap break-words">{node.text}</div>;
  }
  const events = node.notes.filter((n) => n.kind === 'event' && !n.request).map((n) => n.text);
  return (
    <div className="min-w-0 flex flex-col gap-1 pt-1">
      {node.notes.map((n, index) => {
        if (n.kind === 'decision') {
          return (
            <div key={index} className="flex items-center gap-2 text-[13px] text-text-secondary">
              <Icon name="check" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
              <span className="min-w-0 break-words">{n.text}</span>
            </div>
          );
        }
        if (!n.request) return null;
        if (settled && n.request.node.status === 'pending') {
          return (
            <ChatRequestView
              key={index}
              node={n.request.node}
              cardId={n.request.session}
              heading={n.text}
              command={n.request.command}
            />
          );
        }
        return <RequestLine key={index} note={n} request={n.request} />;
      })}
      {events.length > 0 && <div className="text-[12px] text-text-tertiary break-words">{events.join(' · ')}</div>}
    </div>
  );
}

/**
 * A turn Chat spent approving what workers asked, with nothing to read: every
 * note a request it approved, nothing left waiting, and no more than remarks said.
 */
function routine(turn: Turn, running: boolean): boolean {
  const notes = turn.opener?.wake ? (turn.opener.notes ?? []) : [];
  return (
    !running &&
    notes.length > 0 &&
    turn.kept.every((node) => node.kind === 'request' && node.status !== 'pending') &&
    notes.every((note) => note.request && approvedByChat(note.request.node)) &&
    !turn.body.some((node) => said(node) && substantial(node.text))
  );
}

function approvalsSummary(requests: WakeRequest[]): string {
  const noun = requests.every((request) => request.command) ? 'command' : 'request';
  const names = [...new Set(requests.map((request) => request.name))];
  const whose = names.length <= 2 ? names.join(' and ') : `${names.length} tasks`;
  return `Approved ${requests.length} ${noun}${requests.length === 1 ? '' : 's'} for ${whose}`;
}

/** Turns of routine approvals in a row, as one line that opens to each. */
function RoutineApprovals({ turns }: { turns: Turn[] }) {
  const [open, setOpen] = useState(false);
  const notes = turns.flatMap((turn) => turn.opener?.notes ?? []);
  return (
    <div className="min-w-0 flex flex-col">
      <button
        type="button"
        className="w-full min-w-0 min-h-[22px] flex items-center gap-2 text-left text-[13px] text-text-tertiary hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Icon name={open ? 'caret-down' : 'caret-right'} className="w-3 h-3 shrink-0" />
        <span className="flex-1 min-w-0 overflow-hidden whitespace-nowrap">
          {approvalsSummary(notes.map((note) => note.request!))}
        </span>
      </button>
      {open && (
        <div className="pl-5 min-w-0 flex flex-col">
          {notes.map((note, index) => (
            <RequestLine key={index} note={note} request={note.request!} />
          ))}
        </div>
      )}
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
      <ChatMarkdown text={done ? text : closeOpenMarkup(text)} complete={done} />
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
  stopping = false,
  compacting = null,
  onHeld,
}: {
  nodes: ChatNode[];
  context: NodeContext;
  busy: boolean;
  /** Asked to stop: what is still being revealed shows whole at once, and the working line says so. */
  stopping?: boolean;
  /** When a compaction began: it is no turn of its own, so it has a working line of its own. */
  compacting?: number | null;
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
  // Decided as each message arrives, not when it is first drawn: one held
  // behind an earlier message is drawn later, maybe after the turn is over.
  for (const node of nodes) if (node.kind === 'assistant_message') pacedFor(node.id);
  const turns = turnsOf(nodes);
  const open = busy && !compacting;
  const layouts = turns.map((turn, index) => layoutOf(turn, open && index === turns.length - 1));
  const pending = (node: AssistantMessageNode) => !stopping && pacedFor(node.id) && !revealedIds.has(node.id);

  // Each run of routine turns shows as one line, from where it starts.
  let run: Turn[] | null = null;
  const runs = turns.map((turn, index): Turn[] | 'within' | null => {
    if (!routine(turn, open && index === turns.length - 1)) return (run = null);
    if (run) {
      run.push(turn);
      return 'within';
    }
    return (run = [turn]);
  });

  let held = false;
  const shown = layouts.map(({ turn, pieces, doing }, index) => {
    if (held) return null;
    const routineRun = runs[index];
    if (routineRun === 'within') return null;
    if (routineRun) return <RoutineApprovals key={turn.opener!.id} turns={routineRun} />;
    const items: ReactNode[] = [];
    if (turn.opener) {
      items.push(
        turn.opener.wake ? (
          <WakeOpener key={turn.opener.id} node={turn.opener} settled={!(open && index === turns.length - 1)} />
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
      if (piece.kind === 'endings') {
        const shown = piece.nodes.filter((node) => !context.inBar?.has(node.ended!.taskId));
        if (shown.length > 0) {
          items.push(
            <div key={shown[0].id} className="flex flex-col gap-1">
              {shown.map((node) => (
                <ChatNodeView key={node.id} node={node} context={context} />
              ))}
            </div>,
          );
        }
        continue;
      }
      const paced = !stopping && pacedFor(piece.node.id);
      items.push(<Said key={piece.node.id} node={piece.node} paced={paced} onDone={onDone} />);
      if (pending(piece.node)) {
        held = true;
        break;
      }
    }
    if (!held) {
      if (doing) {
        items.push(
          <WorkFold
            key={doing[0]?.id ?? 'doing'}
            work={doing}
            context={context}
            live={{ started: turn.opener?.createdAt ?? turn.body[0]?.createdAt ?? Date.now(), stopping }}
          />,
        );
      }
      for (const node of turn.kept) items.push(<ChatNodeView key={node.id} node={node} context={context} />);
    }
    if (items.length === 0) return null;
    return (
      <div
        key={turn.opener?.id ?? turn.body[0]?.id ?? turn.kept[0]?.id ?? `turn-${index}`}
        className="min-w-0 flex flex-col gap-3"
      >
        {items}
      </div>
    );
  });
  useEffect(() => onHeld?.(held), [held, onHeld]);
  return (
    <div className="chat-turns min-w-0 flex flex-col gap-5">
      {shown}
      {compacting && !held && (
        <WorkFold work={[]} context={context} live={{ started: compacting, stopping, what: 'Compacting' }} />
      )}
    </div>
  );
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
