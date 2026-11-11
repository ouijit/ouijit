// Live before/after demos for the transcript post. Each `<figure data-demo>`
// in a post body becomes a small transcript that replays one scripted agent
// turn under two (or three) rendering rules. The pacing constants match the
// app's useReveal on the chat branch.

type Pace = { floor: number; ceil: number; catchUp: number; unit: 'char' | 'word' } | null;

const SMOOTH: Pace = { floor: 120, ceil: 400, catchUp: 1, unit: 'char' };
const READING: Pace = { floor: 35, ceil: 120, catchUp: 6, unit: 'char' };
const BY_WORD: Pace = { ...SMOOTH, unit: 'word' };

class Cancelled extends Error {}

class Run {
  live = true;
  readonly started = performance.now();
  sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) =>
      setTimeout(() => (this.live ? resolve() : reject(new Cancelled())), ms),
    );
  }
  until(at: number): Promise<void> {
    return this.sleep(Math.max(0, at - this.elapsed()));
  }
  frame(): Promise<number> {
    return new Promise((resolve, reject) =>
      requestAnimationFrame((t) => (this.live ? resolve(t) : reject(new Cancelled()))),
    );
  }
  elapsed(): number {
    return performance.now() - this.started;
  }
}

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Text that grows in chunks and is drawn into `el` at a pace, or as it lands. */
class Reveal {
  text = '';
  closed = false;
  shown = 0;
  private position = 0;
  constructor(
    readonly el: HTMLElement,
    readonly pace: Pace,
  ) {}
  push(chunk: string) {
    this.text += chunk;
    if (!this.pace) this.draw(this.text.length);
  }
  close() {
    this.closed = true;
  }
  done(): boolean {
    return this.closed && this.shown >= this.text.length;
  }
  private draw(n: number) {
    if (this.pace?.unit === 'word' && n < this.text.length) {
      const cut = this.text.slice(0, n);
      n = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n')) + 1;
    }
    if (n === this.shown) return;
    this.shown = n;
    this.el.textContent = this.text.slice(0, n);
  }
  /** Resolves once the text is closed and fully drawn. */
  async play(run: Run): Promise<void> {
    let last = await run.frame();
    while (!this.done()) {
      const now = await run.frame();
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!this.pace) continue;
      const backlog = this.text.length - this.position;
      if (backlog <= 0) continue;
      const { floor, ceil, catchUp } = this.pace;
      const cps = Math.min(ceil, Math.max(floor, backlog / catchUp));
      this.position = Math.min(this.text.length, this.position + cps * seconds);
      this.draw(Math.floor(this.position));
    }
  }
}

/** Sends `text` the way an agent does: uneven chunks after uneven pauses. */
async function write(run: Run, into: Reveal, text: string, seed: number, gap = [40, 420], size = [12, 70]) {
  const rnd = seeded(seed);
  let i = 0;
  while (i < text.length) {
    const n = Math.round(size[0] + rnd() * (size[1] - size[0]));
    into.push(text.slice(i, i + n));
    i += n;
    if (i < text.length) await run.sleep(gap[0] + rnd() * (gap[1] - gap[0]));
  }
  into.close();
}

// --- transcript pieces, in the app's vocabulary ------------------------------

function el(parent: HTMLElement, cls: string, text = ''): HTMLDivElement {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  parent.append(div);
  return div;
}

function statusLine(stage: HTMLElement) {
  const row = el(stage, 'td-status');
  const glyph = el(row, 'td-glyph');
  const grid = document.createElement('span');
  grid.className = 'status-dot-grid';
  grid.style.setProperty('--status-dot-size', '8px');
  grid.style.setProperty('--status-dot-color', 'var(--color-status-thinking)');
  grid.append(...Array.from({ length: 4 }, () => document.createElement('span')));
  glyph.append(grid);
  const phrase = el(row, 'td-phrase', 'Thinking…');
  return {
    row,
    set(text: string) {
      phrase.textContent = text;
    },
  };
}

function fold(stage: HTMLElement, summary: string, open: boolean) {
  const wrap = el(stage, 'td-fold');
  const head = el(wrap, 'td-fold-head');
  const caret = el(head, 'td-caret');
  const label = el(head, 'td-fold-label', summary);
  const body = el(wrap, 'td-fold-body');
  const set = (isOpen: boolean) => {
    caret.dataset.open = String(isOpen);
    body.hidden = !isOpen;
  };
  set(open);
  return {
    wrap,
    body,
    label,
    set,
    add(text: string) {
      el(body, 'td-command', text);
    },
  };
}

// --- the demos ---------------------------------------------------------------

type Demo = {
  modes: string[];
  caption: string;
  height: number;
  play(run: Run, stage: HTMLElement, mode: number, foot: HTMLElement): Promise<void>;
};

const TURN = [
  { at: 0, kind: 'thought', text: 'Checking how the session token gets refreshed.' },
  { at: 900, kind: 'command', text: 'rg -n refreshToken src', step: 'Searching for refreshToken' },
  { at: 1700, kind: 'command', text: 'cat src/auth/session.ts', step: 'Reading src/auth/session.ts' },
  { at: 2400, kind: 'remark', text: "Next I'll check where the expiry is set." },
  { at: 3100, kind: 'command', text: 'npm test -- session', step: 'Running the session tests' },
  { at: 5300, kind: 'thought', text: 'The expiry is read before the refresh lands, so the old value wins.' },
  { at: 6700, kind: 'command', text: 'git diff --stat', step: 'Checking the diff' },
] as const;

const TURN_REPLY =
  'The session expired early because the expiry was read before the refresh finished, so the old timestamp won. ' +
  'I moved the read after the refresh and added a test that refreshes twice in a row. The session tests pass.';

const kinds: Demo = {
  modes: ['As it arrives', 'A turn at a time'],
  caption: 'One agent turn, rendered two ways.',
  height: 320,
  async play(run, stage, mode) {
    if (mode === 0) {
      type Open = { f: ReturnType<typeof fold>; n: number };
      let open: Open | null = null;
      const folds: Open[] = [];
      for (const e of TURN) {
        await run.until(e.at);
        if (e.kind === 'command') {
          if (!open) {
            open = { f: fold(stage, 'Running commands', true), n: 0 };
            folds.push(open);
          }
          open.f.add('$ ' + e.text);
          open.n++;
          continue;
        }
        open = null;
        if (e.kind === 'thought') write(run, new Reveal(el(stage, 'td-thought'), null), e.text, e.at, [30, 160]);
        else write(run, new Reveal(el(stage, 'td-reply'), null), e.text, e.at, [30, 160]);
      }
      await run.until(7600);
      for (const { f, n } of folds) {
        f.set(false);
        f.label.textContent = `Ran ${n} command${n === 1 ? '' : 's'}`;
      }
      const reply = new Reveal(el(stage, 'td-reply'), null);
      await Promise.all([write(run, reply, TURN_REPLY, 7, [60, 380]), reply.play(run)]);
      return;
    }

    const status = statusLine(stage);
    let latest = '';
    let showing = '';
    let shownAt = -Infinity;
    void (async () => {
      for (;;) {
        await run.sleep(50);
        if (latest && latest !== showing && run.elapsed() - shownAt >= 2000) {
          showing = latest;
          shownAt = run.elapsed();
          status.set(showing);
        }
      }
    })().catch(() => {});
    for (const e of TURN) {
      await run.until(e.at);
      latest = e.kind === 'command' ? e.step : e.text;
    }
    await run.until(7600);
    status.row.remove();
    fold(stage, 'Ran 4 commands, thought twice · 8s', false);
    const reply = new Reveal(el(stage, 'td-reply'), SMOOTH);
    await Promise.all([write(run, reply, TURN_REPLY, 7, [60, 380]), reply.play(run)]);
  },
};

const STEPS = [
  { at: 0, step: 'Reading src/auth/session.ts', ends: 700 },
  { at: 900, step: 'Running the session tests', ends: 2600 },
  { at: 2800, step: 'Reading test/session.test.ts', ends: 3300 },
  { at: 3500, step: 'Searching for expiresAt', ends: 3900 },
  { at: 4100, step: 'Running the session tests', ends: 5600 },
  { at: 5800, step: 'Checking the diff', ends: 6200 },
];

const status: Demo = {
  modes: ['Falls back', 'Holds'],
  caption: 'The status line over the same run of commands.',
  height: 72,
  async play(run, stage, mode) {
    const line = statusLine(stage);
    if (mode === 0) {
      for (const s of STEPS) {
        await run.until(s.at);
        line.set(s.step);
        await run.until(s.ends);
        line.set('Thinking…');
      }
      await run.sleep(800);
      return;
    }
    let shownAt = -Infinity;
    let showing = '';
    let i = 0;
    while (run.elapsed() < 8000) {
      while (i < STEPS.length && STEPS[i].at <= run.elapsed()) i++;
      const latest = i > 0 ? STEPS[i - 1].step : '';
      if (latest && latest !== showing && run.elapsed() - shownAt >= 2000) {
        showing = latest;
        shownAt = run.elapsed();
        line.set(showing);
      }
      await run.sleep(50);
    }
  },
};

const PACED_REPLY =
  'The fix is in src/auth/session.ts. The expiry was read before the refresh finished, so a session refreshed ' +
  'twice in quick succession kept the first timestamp and expired on schedule. The read now happens after the ' +
  'refresh resolves, and a new test refreshes twice in a row and checks the later expiry wins. The session tests ' +
  'pass, and nothing outside auth changed.';

function stopwatch(foot: HTMLElement) {
  foot.textContent = '';
  const agent = el(foot, 'td-meter');
  const shown = el(foot, 'td-meter');
  return {
    agent: (s: number) => (agent.textContent = `Agent finished ${(s / 1000).toFixed(1)} s`),
    shown: (s: number) => (shown.textContent = `On screen ${(s / 1000).toFixed(1)} s`),
  };
}

const pacing: Demo = {
  modes: ['As it lands', 'Reading speed', 'Smoothed'],
  caption: 'The same bursts, revealed three ways.',
  height: 200,
  async play(run, stage, mode, foot) {
    const watch = stopwatch(foot);
    const reply = new Reveal(el(stage, 'td-reply'), [null, READING, SMOOTH][mode]);
    await Promise.all([
      write(run, reply, PACED_REPLY, 3, [150, 700], [15, 90]).then(() => watch.agent(run.elapsed())),
      reply.play(run).then(() => watch.shown(run.elapsed())),
    ]);
  },
};

const LONG_WORDS =
  'Synchronising the authentication middleware with the refresh-token implementation required ' +
  'reinitialising the configuration, invalidating outstanding authorisations, and rerunning the ' +
  'internationalisation regression suite.';

const clicky: Demo = {
  modes: ['By word', 'By character'],
  caption: 'Both at the same speed.',
  height: 130,
  async play(run, stage, mode) {
    const reply = new Reveal(el(stage, 'td-reply'), mode === 0 ? BY_WORD : SMOOTH);
    await Promise.all([write(run, reply, LONG_WORDS, 11, [60, 300]), reply.play(run)]);
  },
};

const FIRST =
  'Here is where the three earlier steps landed. The search found refreshToken in two places: the session module ' +
  'and an old helper nothing imports any more. The session module reads the expiry before the refresh resolves, ' +
  'which is the bug. The tests cover a single refresh but never two in a row, so they passed. The fix moves the ' +
  'read after the refresh, and a new test refreshes twice and checks the later expiry wins. Both are written.';
const SECOND = 'Committing needs your approval.';

const queue: Demo = {
  modes: ['Each on its own', 'One queue'],
  caption: 'A slow message, then a fast one.',
  height: 300,
  async play(run, stage, mode) {
    const first = new Reveal(el(stage, 'td-reply'), SMOOTH);
    const firstPlay = Promise.all([write(run, first, FIRST, 5, [80, 200], [180, 320]), first.play(run)]);
    const foldSlot = el(stage, 'td-slot');
    const secondEl = el(stage, 'td-reply');
    const second = new Reveal(secondEl, SMOOTH);
    await run.until(700);
    if (mode === 1) await firstPlay;
    foldSlot.replaceWith(fold(stage, 'Ran 2 commands · 3s', false).wrap);
    second.push(SECOND);
    second.close();
    stage.append(secondEl);
    await Promise.all([firstPlay, second.play(run)]);
  },
};

const DEMOS: Record<string, Demo> = { kinds, status, pacing, clicky, queue };

// --- mounting ----------------------------------------------------------------

function mount(figure: HTMLElement) {
  const demo = DEMOS[figure.dataset.demo ?? ''];
  if (!demo) return;
  figure.classList.add('td');
  figure.innerHTML = '';

  const frame = el(figure, 'td-frame glass-bevel');
  const bar = el(frame, 'td-bar');
  const toggle = el(bar, 'td-toggle glass-bevel');
  const replay = document.createElement('button');
  replay.className = 'td-replay';
  replay.type = 'button';
  replay.textContent = 'Replay';
  bar.append(replay);
  const stage = el(frame, 'td-stage');
  stage.style.setProperty('--td-height', `${demo.height}px`);
  const foot = el(frame, 'td-foot');
  const caption = document.createElement('figcaption');
  caption.textContent = demo.caption;
  figure.append(caption);

  let mode = 0;
  let run: Run | null = null;
  const buttons = demo.modes.map((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      mode = i;
      start();
    });
    toggle.append(b);
    return b;
  });

  function start(then?: () => void) {
    if (run) run.live = false;
    const current = new Run();
    run = current;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === mode)));
    stage.innerHTML = '';
    foot.textContent = '';
    const inner = el(stage, 'td-scroll');
    demo
      .play(current, inner, mode, foot)
      .then(() => current.sleep(1800))
      .then(() => then?.())
      .catch((e) => {
        if (!(e instanceof Cancelled)) throw e;
      });
  }

  replay.addEventListener('click', () => start());

  buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === mode)));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const seen = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        start(() => {
          mode = demo.modes.length - 1;
          start();
        });
      }
    },
    { threshold: 0.6 },
  );
  seen.observe(figure);
}

export function mountTranscriptDemos() {
  document.querySelectorAll<HTMLElement>('figure[data-demo]').forEach(mount);
}
