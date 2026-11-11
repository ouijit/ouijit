import { useEffect, useRef, useState } from 'react';
import { Icon } from '../terminal/Icon';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatNodeView, ThoughtLine, foldSummary, formatSpan, isEmptyThought, type NodeContext } from './ChatNodes';
import type { ChatNode, UserMessageNode } from '../../chat/model';

interface Turn {
  opener: UserMessageNode | null;
  work: ChatNode[];
  reply: ChatNode | null;
  /** Shown whatever the turn's state: what stops for the user, and failures. */
  kept: ChatNode[];
}

const KEPT: ChatNode['kind'][] = ['request', 'notice', 'plan'];

function turnsOf(nodes: ChatNode[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const node of nodes) {
    if (node.kind === 'user_message') {
      current = { opener: node, work: [], reply: null, kept: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { opener: null, work: [], reply: null, kept: [] };
      turns.push(current);
    }
    if (KEPT.includes(node.kind)) current.kept.push(node);
    else if (!isEmptyThought(node)) current.work.push(node);
  }
  for (const turn of turns) {
    const last = turn.work.findLastIndex((n) => n.kind === 'assistant_message' && n.text.trim() !== '');
    if (last !== -1) [turn.reply] = turn.work.splice(last, 1);
  }
  return turns;
}

/** What the agent is doing now, in a phrase: the step it is on, else the start of its last thought. */
function doingNow(work: ChatNode[]): string {
  for (let i = work.length - 1; i >= 0; i--) {
    const node = work[i];
    if (node.kind === 'tool_call' && node.status === 'running') return `${node.title.replace(/[.…]+$/, '')}…`;
    // A thought still streaming in is a few words of a sentence; it is read once it is whole.
    if (node.kind === 'reasoning' && node.status !== 'running' && node.text.trim()) {
      const sentence = node.text.trim().split(/(?<=[.!?])\s/)[0];
      return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence;
    }
    if (node.kind === 'tool_call') break;
  }
  return 'Thinking…';
}

/** Each phrase stays up long enough to read before the next replaces it; ones in between are skipped. */
const HOLD_MS = 1500;

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
  const phrase = useHeld(doingNow(work));
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
      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse motion-reduce:animate-none shrink-0" />
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

/**
 * A transcript a turn at a time: what started it, one closed line for the
 * work, and what it said last. While a turn runs, only a line saying what it
 * is doing now: the work is never shown happening and then put away.
 */
export function ChatTurns({ nodes, context, busy }: { nodes: ChatNode[]; context: NodeContext; busy: boolean }) {
  const turns = turnsOf(nodes);
  return (
    <div className="chat-turns flex flex-col gap-5">
      {turns.map((turn, index) => {
        const running = busy && index === turns.length - 1;
        const key = turn.opener?.id ?? turn.work[0]?.id ?? turn.kept[0]?.id ?? `turn-${index}`;
        return (
          <div key={key} className="flex flex-col gap-3">
            {turn.opener &&
              (turn.opener.wake ? (
                <WakeOpener node={turn.opener} />
              ) : (
                <ChatNodeView node={turn.opener} context={context} />
              ))}
            {running ? (
              <Doing
                work={turn.reply ? [...turn.work, turn.reply] : turn.work}
                started={turn.opener?.createdAt ?? turn.work[0]?.createdAt ?? Date.now()}
              />
            ) : (
              <>
                {turn.work.length > 0 && <WorkFold work={turn.work} context={context} />}
                {turn.reply?.kind === 'assistant_message' && <ChatMarkdown text={turn.reply.text} complete />}
              </>
            )}
            {turn.kept.map((node) => (
              <ChatNodeView key={node.id} node={node} context={context} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
