/** Most kept for one conversation; past that the oldest go, and it is told how many. */
const MAX_HELD = 50;

interface Box {
  messages: string[];
  dropped: number;
}

/**
 * What Chat is told, held per conversation until it can take it: a
 * conversation in a turn, or not running, gets everything that arrived
 * meanwhile in one message once it is free, so a burst costs one turn.
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
      send: (id: string, text: string) => Promise<void>;
    },
  ) {}

  async post(id: string, text: string): Promise<void> {
    const box = this.boxes.get(id) ?? { messages: [], dropped: 0 };
    box.messages.push(text);
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
    if (!this.target.ready(id)) return;
    this.boxes.delete(id);
    this.sending.add(id);
    try {
      await this.target.send(id, letter(box));
    } finally {
      this.sending.delete(id);
    }
    // Whatever arrived while that was going out, if the turn it started is already over.
    await this.deliver(id);
  }
}

function letter(box: Box): string {
  if (box.messages.length === 1 && box.dropped === 0) return `Ouijit: ${box.messages[0]}`;
  const earlier = box.dropped ? `\n- and ${box.dropped} earlier, no longer kept` : '';
  return `Ouijit: while you were busy or away:\n${box.messages.map((m) => `- ${m}`).join('\n')}${earlier}`;
}
