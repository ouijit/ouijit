import { randomUUID } from 'node:crypto';
import type { DriverSession, UserInput } from '../agents';
import type { ChatDelivery } from './startOptions';
import type { ChatAttachment, UserMessageNode, WakeNote } from './model';
import { chatLog, type HostedSession } from './hostedSession';

export interface PromptInput {
  text: string;
  attachments?: ChatAttachment[];
  wake?: boolean;
  notes?: WakeNote[];
}

/**
 * Send a message. `auto` steers a running turn where the agent can, queues it
 * where it cannot, and starts a turn when the agent is idle.
 */
export async function deliverPrompt(
  session: HostedSession,
  driver: DriverSession,
  input: PromptInput,
  delivery: ChatDelivery,
  busy: boolean,
): Promise<string> {
  const node: UserMessageNode = {
    id: `user-${randomUUID()}`,
    kind: 'user_message',
    parentId: null,
    createdAt: Date.now(),
    text: input.text,
    attachments: input.attachments ?? [],
    delivery: 'prompt',
    ...(input.wake && { wake: true }),
    ...(input.notes?.length && { notes: input.notes }),
  };
  const userInput: UserInput & { id: string } = { id: node.id, text: node.text, attachments: node.attachments };
  if (!busy) {
    // Any the agent never read, from a turn that was stopped, stay where they were sent.
    session.unread.clear();
    session.emit({ type: 'node', node });
    session.emit({ type: 'session', patch: { status: 'running' } });
    await runTurn(session, () => driver.prompt(userInput));
    return node.id;
  }
  const wantsSteer = delivery === 'steer' || (delivery === 'auto' && driver.capabilities.steer);
  // Held by Ouijit during a compaction, which would otherwise take the message into what it summarizes.
  const held = session.info.compacting || (!(wantsSteer && driver.capabilities.steer) && !driver.capabilities.queue);
  if (held) {
    const queued = { ...node, delivery: 'queued' as const };
    session.queued.push(queued);
    session.emit({ type: 'node', node: queued });
  } else if (wantsSteer && driver.capabilities.steer) {
    session.emit({ type: 'node', node: { ...node, delivery: 'steer' } });
    session.unread.set(node.id, false);
    await runTurn(session, () => driver.send(userInput, 'steer'));
  } else {
    session.emit({ type: 'node', node: { ...node, delivery: 'queued' } });
    session.unread.set(node.id, false);
    await runTurn(session, () => driver.send(userInput, 'queue'));
  }
  return node.id;
}

/** A mode picked during the turn takes effect first, so a queued message runs under it. */
export async function endTurn(session: HostedSession): Promise<void> {
  const pending = session.info.pendingMode;
  if (pending && session.driver?.setMode) {
    try {
      await session.driver.setMode(pending);
      session.emit({ type: 'session', patch: { mode: pending, pendingMode: null } });
    } catch (error) {
      chatLog.warn('mode did not apply', { id: session.info.id, mode: pending, error: String(error) });
      session.emit({ type: 'session', patch: { pendingMode: null } });
    }
  }
  await drainQueue(session);
}

async function drainQueue(session: HostedSession): Promise<void> {
  const next = session.queued.shift();
  if (!next || !session.driver) return;
  const driver = session.driver;
  // Moved to the end: it is sent now, after whatever the finished turn wrote.
  session.emit({ type: 'remove', ids: [next.id] });
  session.emit({ type: 'node', node: { ...next, delivery: 'prompt', createdAt: Date.now() } });
  session.emit({ type: 'session', patch: { status: 'running' } });
  await runTurn(session, () => driver.prompt({ id: next.id, text: next.text, attachments: next.attachments }));
}

/** A driver call failing ends the turn with the failure in the transcript rather than an exception. */
export async function runTurn(session: HostedSession, call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    session.emit({
      type: 'node',
      node: {
        id: `notice-${randomUUID()}`,
        kind: 'notice',
        parentId: null,
        createdAt: Date.now(),
        level: 'error',
        text,
      },
    });
    if (session.info.status === 'running' || session.info.status === 'awaiting') {
      session.emit({ type: 'session', patch: { status: 'idle', compacting: null } });
    }
  }
}
