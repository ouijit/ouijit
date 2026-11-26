import type { WakeNote } from './model';

/** Most kept for one conversation; past that the oldest go, and it is told how many. */
const MAX_HELD = 50;

interface Held {
  text: string;
  note: WakeNote;
  /** False once what it reports is no longer so: it is dropped rather than delivered late. */
  current?: () => boolean;
}

interface Box {
  messages: Held[];
  dropped: number;
}

/**
 * What Chat is told, held per conversation until it can take it: a
 * conversation in a turn gets everything that arrived meanwhile in one
 * message once it is free, so a burst costs one turn, and one not running is
 * started to take it.
 */
export class Mailbox {
  private readonly boxes = new Map<string, Box>();
  private readonly sending = new Set<string>();

  constructor(
    private readonly target: {
      /** Gone for good: what was held for it is dropped. */
      exists: (id: string) => boolean;
      /** Running and between turns. */
      ready: (id: string) => boolean;
      /** Not ready: start it if it is not running, and call `deliver` once it is ready. */
      wake: (id: string) => void;
      send: (id: string, text: string, notes: WakeNote[]) => Promise<void>;
    },
  ) {}

  async post(id: string, text: string, note: WakeNote, current?: () => boolean): Promise<void> {
    const box = this.boxes.get(id) ?? { messages: [], dropped: 0 };
    box.messages.push({ text, note, current });
    if (box.messages.length > MAX_HELD) box.dropped += box.messages.splice(0, box.messages.length - MAX_HELD).length;
    this.boxes.set(id, box);
    await this.deliver(id);
  }

  /** Call when a conversation may have become ready. */
  async deliver(id: string): Promise<void> {
    const box = this.boxes.get(id);
    if (!box || this.sending.has(id)) return;
    if (!this.target.exists(id)) {
      this.boxes.delete(id);
      return;
    }
    box.messages = box.messages.filter((message) => message.current?.() ?? true);
    if (box.messages.length === 0 && box.dropped === 0) {
      this.boxes.delete(id);
      return;
    }
    if (!this.target.ready(id)) {
      this.target.wake(id);
      return;
    }
    this.boxes.delete(id);
    this.sending.add(id);
    try {
      await this.target.send(
        id,
        letter(box),
        box.messages.map((m) => m.note),
      );
    } finally {
      this.sending.delete(id);
    }
    // Whatever arrived while that was going out, if the turn it started is already over.
    await this.deliver(id);
  }
}

function letter(box: Box): string {
  const texts = box.messages.map((m) => m.text);
  if (texts.length === 1 && box.dropped === 0) return `Ouijit: ${texts[0]}`;
  const earlier = box.dropped ? `\n- and ${box.dropped} earlier, no longer kept` : '';
  return `Ouijit: while you were busy or away:\n${texts.map((t) => `- ${t}`).join('\n')}${earlier}`;
}
