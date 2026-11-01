import { useState } from 'react';
import type { ChatAnswer, RequestNode, RequestOption } from '../../chat/model';
import { terminalInstances } from '../terminal/terminalRegistry';

function answerLabel(node: RequestNode): string {
  const answer = node.answer;
  if (!answer || node.status === 'cancelled' || answer.kind === 'cancel') return 'Dismissed';
  if (answer.kind === 'option')
    return node.options.find((option) => option.id === answer.optionId)?.label ?? 'Answered';
  return 'Answered';
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

function withoutWorktree(text: string, cardId: string): string {
  const root = terminalInstances.get(cardId)?.worktreePath;
  return root ? text.split(`${root}/`).join('') : text;
}

/** Something the agent is blocked on. Any client can answer it; the first answer wins. */
export function ChatRequestView({ node, cardId }: { node: RequestNode; cardId: string }) {
  if (node.status !== 'pending') {
    return (
      <div className="text-[13px] text-text-tertiary">
        {node.title} · {answerLabel(node)}
      </div>
    );
  }
  return (
    <div className="glass-bevel rounded-[12px] border border-bezel bg-terminal-surface px-3 py-2.5 flex flex-col gap-2">
      <div className="text-sm text-text-primary break-words">{withoutWorktree(node.title, cardId)}</div>
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
