import { useState } from 'react';
import { FadeLine } from '../ui/FadeLine';
import type { ChatAnswer, RequestNode, RequestOption } from '../../chat/model';
import { Icon } from '../terminal/Icon';
import { ChatMarkdown } from './ChatMarkdown';
import { relativeToCard } from './cardPaths';

/** A command as a reply's code block: monospace, highlighted, with its copy button. */
export function CommandBlock({ command }: { command: string }) {
  const fence = command.includes('```') ? '~~~~' : '```';
  return <ChatMarkdown text={`${fence}sh\n${command}\n${fence}`} complete />;
}

function chosenKind(node: RequestNode): RequestOption['kind'] | undefined {
  const answer = node.answer;
  return answer?.kind === 'option' ? node.options.find((option) => option.id === answer.optionId)?.kind : undefined;
}

export function allowed(node: RequestNode): boolean {
  return node.status === 'answered' && !!chosenKind(node)?.startsWith('allow');
}

export function approvedByChat(node: RequestNode): boolean {
  return allowed(node) && !!node.byChat;
}

/** How a request was settled, and by Chat where it was; null while it waits. */
export function settledLabel(node: RequestNode): string | null {
  if (node.status === 'pending') return null;
  const answer = node.answer;
  if (!answer || node.status === 'cancelled' || answer.kind === 'cancel') return 'Dismissed';
  const kind = chosenKind(node);
  const label = kind?.startsWith('allow') ? 'Allowed' : kind?.startsWith('reject') ? 'Declined' : 'Answered';
  return node.byChat ? `${label} by Chat` : label;
}

/** What a step says it does, where the agent described it; undefined where its title is only the raw command. */
export function stepTitle(call: { title: string; command?: string }): string | undefined {
  const title = call.title?.trim();
  if (!title || title === call.command?.trim()) return undefined;
  return title.replace(/[.…]+$/, '');
}

export function firstLine(text: string): string {
  return text.trim().split('\n')[0];
}

/** A request as one quiet line, cut to the width; what it asked for in full behind the disclosure. */
export function SettledLine({
  summary,
  label,
  command,
  detail,
}: {
  summary: string;
  label: string | null;
  command?: string;
  detail?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 flex flex-col">
      <button
        type="button"
        className="w-full min-w-0 min-h-[22px] flex items-center gap-2 text-left text-[13px] text-text-tertiary hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Icon name={open ? 'caret-down' : 'caret-right'} className="w-3 h-3 shrink-0" />
        <FadeLine className="flex-1">{summary}</FadeLine>
        {label && <span className="shrink-0 text-[12px]">{label}</span>}
      </button>
      {open && (
        <div className="pl-5 min-w-0">
          {command ? (
            <CommandBlock command={command} />
          ) : (
            <div className="text-[13px] text-text-secondary whitespace-pre-wrap break-words py-1">{detail}</div>
          )}
        </div>
      )}
    </div>
  );
}

function optionClass(option: RequestOption, first: boolean): string {
  const primary = option.kind === 'allow_once' || (first && option.kind === 'other');
  return primary ? 'btn-primary btn-compact' : 'btn-secondary btn-compact';
}

function respond(cardId: string, node: RequestNode, answer: ChatAnswer): void {
  void window.api.chat.answer(cardId, node.id, answer);
}

function Approval({ node, cardId }: { node: RequestNode; cardId: string }) {
  const [message, setMessage] = useState('');
  const [explaining, setExplaining] = useState(false);
  const rejecting = node.options.find((option) => option.kind === 'reject_once');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {node.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className={optionClass(option, index === 0)}
            onClick={() => respond(cardId, node, { kind: 'option', optionId: option.id })}
          >
            {option.label}
          </button>
        ))}
        {rejecting && (
          <button
            type="button"
            className="ml-auto text-[12px] text-text-tertiary hover:text-text-primary transition-colors duration-100"
            onClick={() => setExplaining((v) => !v)}
          >
            Decline with a note
          </button>
        )}
      </div>
      {explaining && rejecting && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            respond(cardId, node, { kind: 'option', optionId: rejecting.id, message: message.trim() || undefined });
          }}
        >
          <input
            className="field flex-1"
            placeholder="What should it do instead?"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-secondary btn-compact">
            {rejecting.label}
          </button>
        </form>
      )}
    </div>
  );
}

function Questions({ node, cardId }: { node: RequestNode; cardId: string }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const toggle = (questionId: string, label: string, multi: boolean) =>
    setAnswers((current) => {
      const chosen = current[questionId] ?? [];
      if (!multi) return { ...current, [questionId]: [label] };
      return {
        ...current,
        [questionId]: chosen.includes(label) ? chosen.filter((c) => c !== label) : [...chosen, label],
      };
    });
  const submit = () => {
    const merged: Record<string, string[]> = {};
    for (const question of node.questions) {
      const text = texts[question.id]?.trim();
      merged[question.id] = [...(answers[question.id] ?? []), ...(text ? [text] : [])];
    }
    respond(cardId, node, { kind: 'answers', answers: merged });
  };
  return (
    <div className="flex flex-col gap-3">
      {node.questions.map((question) => (
        <div key={question.id} className="flex flex-col gap-1.5">
          {node.questions.length > 1 && <div className="text-sm text-text-primary">{question.question}</div>}
          {question.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const chosen = answers[question.id]?.includes(option.label) ?? false;
                return (
                  <button
                    key={option.label}
                    type="button"
                    title={option.description}
                    aria-pressed={chosen}
                    className={chosen ? 'btn-primary btn-compact' : 'btn-secondary btn-compact'}
                    onClick={() => toggle(question.id, option.label, question.multiSelect)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
          {question.allowText && (
            <input
              className="field"
              placeholder={question.options.length ? 'Or write your own' : 'Your answer'}
              value={texts[question.id] ?? ''}
              onChange={(event) => setTexts((t) => ({ ...t, [question.id]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className="btn-primary btn-compact" onClick={submit}>
          Answer
        </button>
        <button
          type="button"
          className="btn-secondary btn-compact"
          onClick={() => respond(cardId, node, { kind: 'cancel' })}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Something the agent is blocked on. Any client can answer it; the first answer
 * wins. `heading` and `command` describe it where it is shown away from its own transcript.
 */
export function ChatRequestView({
  node,
  cardId,
  heading,
  command,
  step,
}: {
  node: RequestNode;
  cardId: string;
  heading?: string;
  command?: string;
  /** What the gated step says it does; named on the settled line in place of its command. */
  step?: string;
}) {
  if (node.status !== 'pending') {
    return (
      <SettledLine
        summary={firstLine(relativeToCard(step ?? command ?? node.title, cardId))}
        label={settledLabel(node)}
        command={command}
        detail={[node.title, node.detail].filter(Boolean).join('\n\n')}
      />
    );
  }
  return (
    <div className="min-w-0 glass-bevel rounded-[12px] border border-bezel bg-terminal-surface px-3 py-2.5 flex flex-col gap-2">
      <div className="text-sm text-text-primary break-words">{heading ?? relativeToCard(node.title, cardId)}</div>
      {command && <CommandBlock command={command} />}
      {node.detail && (
        <pre className="font-mono text-[12px] text-text-secondary whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {node.detail}
        </pre>
      )}
      {node.request === 'approval' ? (
        <Approval node={node} cardId={cardId} />
      ) : (
        <Questions node={node} cardId={cardId} />
      )}
    </div>
  );
}
