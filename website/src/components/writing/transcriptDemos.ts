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

/**
 * Lets a demo's fixed-height stage scroll while one of its folds is open, and
 * brings the fold's header into view, since the transcript is drawn from the
 * bottom up and an opened fold would otherwise push it out of the top.
 */
function revealFold(wrap: HTMLElement) {
  const stage = wrap.closest<HTMLElement>('.td-stage');
  if (!stage) return;
  const anyOpen = stage.querySelector('.td-fold-body:not([hidden])') !== null;
  stage.classList.toggle('td-stage-scrolling', anyOpen || stage.dataset.scroll === 'always');
  if (!anyOpen) return;
  const offset = wrap.getBoundingClientRect().top - stage.getBoundingClientRect().top;
  stage.scrollTop += offset - 32;
}

function fold(stage: HTMLElement, summary: string, open: boolean) {
  const wrap = el(stage, 'td-fold');
  const head = el(wrap, 'td-fold-head');
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  const caret = el(head, 'td-caret');
  caret.innerHTML =
    '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const label = el(head, 'td-fold-label', summary);
  const body = el(wrap, 'td-fold-body');
  const set = (isOpen: boolean) => {
    caret.dataset.open = String(isOpen);
    head.setAttribute('aria-expanded', String(isOpen));
    body.hidden = !isOpen;
  };
  set(open);
  const toggle = () => {
    set(body.hidden);
    revealFold(wrap);
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggle();
  });
  return {
    wrap,
    body,
    label,
    set,
    add(text: string, cls = 'td-command') {
      el(body, cls, text);
    },
  };
}

// --- the demos ---------------------------------------------------------------

type Demo = {
  modes: string[];
  caption: string;
  height: number;
  footer?: boolean;
  /** Plays every mode at once, in panes side by side, instead of behind a toggle. */
  sideBySide?: boolean;
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
  caption: 'Every step streamed into the transcript vs one status line that folds away when the turn ends.',
  height: 130,
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
        if (e.kind === 'thought') write(run, new Reveal(el(stage, 'td-thought'), null), e.text, e.at, [30, 160]).catch(() => {});
        else write(run, new Reveal(el(stage, 'td-reply'), null), e.text, e.at, [30, 160]).catch(() => {});
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
    const work = fold(stage, 'Ran 4 commands, thought twice · 8s', false);
    for (const e of TURN) work.add(e.kind === 'command' ? '$ ' + e.text : e.text, e.kind === 'command' ? 'td-command' : 'td-thought');
    const reply = new Reveal(el(stage, 'td-reply'), SMOOTH);
    await Promise.all([write(run, reply, TURN_REPLY, 7, [60, 380]), reply.play(run)]);
  },
};

const STEPS = [
  { at: 0, step: 'Reading src/auth/session.ts' },
  { at: 900, step: 'Running the session tests' },
  { at: 2800, step: 'Reading test/session.test.ts' },
  { at: 3500, step: 'Searching for expiresAt' },
  { at: 4100, step: 'Running the session tests' },
  { at: 5800, step: 'Checking the diff' },
];

const status: Demo = {
  modes: ['No hold', 'Held'],
  caption: 'Each step replaced when the next starts vs held two seconds so it can be read.',
  height: 72,
  async play(run, stage, mode) {
    const line = statusLine(stage);
    if (mode === 0) {
      for (const s of STEPS) {
        await run.until(s.at);
        line.set(s.step);
      }
      await run.until(8000);
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
  const agent = el(foot, 'td-meter', 'Agent finished –');
  const shown = el(foot, 'td-meter', 'On screen –');
  return {
    agent: (s: number) => (agent.textContent = `Agent finished ${(s / 1000).toFixed(1)} s`),
    shown: (s: number) => (shown.textContent = `On screen ${(s / 1000).toFixed(1)} s`),
  };
}

const pacing: Demo = {
  modes: ['Unpaced', 'Slow', 'Fast'],
  caption: 'Bursts shown as they arrive vs revealed at the slow and fast settings.',
  height: 120,
  footer: true,
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
  caption: 'Advancing a word at a time vs a few characters every frame, at the same speed.',
  height: 96,
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
  caption: 'A short message arrives while the one above is still revealing.',
  height: 150,
  async play(run, stage, mode) {
    const first = new Reveal(el(stage, 'td-reply'), SMOOTH);
    const firstPlay = Promise.all([write(run, first, FIRST, 5, [80, 200], [180, 320]), first.play(run)]);
    const foldSlot = el(stage, 'td-slot');
    const secondEl = el(stage, 'td-reply');
    const second = new Reveal(secondEl, SMOOTH);
    await run.until(700);
    if (mode === 1) await firstPlay;
    const work = fold(stage, 'Ran 2 commands · 3s', false);
    work.add('$ rg -n refreshToken src');
    work.add('$ npm test -- session');
    foldSlot.replaceWith(work.wrap);
    second.push(SECOND);
    second.close();
    stage.append(secondEl);
    await Promise.all([firstPlay, second.play(run)]);
  },
};

const WHOLE_TURN = [
  { at: 0, kind: 'thought', text: 'Checking how the session token gets refreshed.' },
  { at: 700, kind: 'command', text: 'rg -n refreshToken src', step: 'Searching for refreshToken' },
  { at: 1100, kind: 'command', text: 'cat src/auth/session.ts', step: 'Reading src/auth/session.ts' },
  { at: 1800, kind: 'remark', text: "Next I'll check where the expiry is set." },
  { at: 2400, kind: 'command', text: 'npm test -- session', step: 'Running the session tests' },
  {
    at: 3900,
    kind: 'message',
    text:
      'Found it. The expiry is read in two places:\n' +
      '- src/auth/session.ts reads it before the refresh resolves\n' +
      '- an old helper reads it too, but nothing imports it',
  },
  { at: 5600, kind: 'thought', text: 'Moving the read after the refresh should be enough.' },
  { at: 6000, kind: 'command', text: 'git apply fix.patch', step: 'Applying the fix' },
  { at: 6300, kind: 'command', text: 'npm test -- session', step: 'Running the session tests' },
] as const;
const WHOLE_END = 8400;
const WHOLE_PROMPT = 'Sessions keep expiring early. Can you find out why and fix it?';
const WHOLE_REPLY =
  'Sessions expired early because the expiry was read before the refresh finished. The read now waits for the ' +
  'refresh, and a new test refreshes twice in a row and checks the later expiry wins. The session tests pass.';

const whole: Demo = {
  modes: ['Basic', 'Together'],
  caption: 'A basic transcript vs everything above together, over the same turn.',
  height: 300,
  sideBySide: true,
  async play(run, stage, mode) {
    el(stage, 'td-prompt', WHOLE_PROMPT);
    if (mode === 0) {
      let seed = 30;
      for (const e of WHOLE_TURN) {
        await run.until(e.at);
        if (e.kind === 'command') {
          el(stage, 'td-command', '$ ' + e.text);
          continue;
        }
        const cls = e.kind === 'thought' ? 'td-thought' : 'td-reply';
        write(run, new Reveal(el(stage, cls), null), e.text, seed++, [30, 200], [10, 60]).catch(() => {});
      }
      await run.until(WHOLE_END);
      await write(run, new Reveal(el(stage, 'td-reply'), null), WHOLE_REPLY, seed, [60, 420], [12, 80]);
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

    const reveals: Promise<void>[] = [];
    let seed = 30;
    for (const e of WHOLE_TURN) {
      await run.until(e.at);
      if (e.kind === 'message') {
        const message = new Reveal(document.createElement('div'), SMOOTH);
        message.el.className = 'td-reply';
        stage.insertBefore(message.el, status.row);
        reveals.push(write(run, message, e.text, seed++, [30, 200], [10, 60]), message.play(run));
        continue;
      }
      latest = e.kind === 'command' ? e.step : e.text;
    }
    await run.until(WHOLE_END);
    await Promise.all(reveals);
    status.row.remove();
    const work = fold(stage, 'Ran 5 commands, thought twice · 8s', false);
    for (const e of WHOLE_TURN) {
      if (e.kind !== 'message') work.add(e.kind === 'command' ? '$ ' + e.text : e.text, e.kind === 'command' ? 'td-command' : 'td-thought');
    }
    const reply = new Reveal(el(stage, 'td-reply'), SMOOTH);
    await Promise.all([write(run, reply, WHOLE_REPLY, seed, [60, 420], [12, 80]), reply.play(run)]);
  },
};

const DEMOS: Record<string, Demo> = { kinds, status, pacing, clicky, queue, whole };

// --- mounting ----------------------------------------------------------------

function mount(figure: HTMLElement) {
  const demo = DEMOS[figure.dataset.demo ?? ''];
  if (!demo) return;
  figure.classList.add('td');
  figure.innerHTML = '';
  if (demo.sideBySide) return mountSideBySide(figure, demo);

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
  if (demo.footer) stopwatch(foot);
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

  function start() {
    if (run) run.live = false;
    const current = new Run();
    run = current;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === mode)));
    stage.innerHTML = '';
    stage.classList.remove('td-stage-scrolling');
    const inner = el(stage, 'td-scroll');
    demo.play(current, inner, mode, foot).catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
  }

  replay.addEventListener('click', start);

  buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === mode)));
  const seen = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        start();
      }
    },
    { threshold: 0.6 },
  );
  seen.observe(figure);
}

/** Keeps a scrollable stage pinned to its newest line until the reader scrolls up, and again once they return to the bottom. */
function followBottom(stage: HTMLElement) {
  let following = true;
  let lastTop = 0;
  stage.addEventListener('scroll', () => {
    const atBottom = stage.scrollHeight - stage.clientHeight - stage.scrollTop < 2;
    if (stage.scrollTop < lastTop - 1) following = false;
    else if (atBottom) following = true;
    lastTop = stage.scrollTop;
  });
  const tick = () => {
    if (following) stage.scrollTop = stage.scrollHeight;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    following = true;
    lastTop = 0;
  };
}

function mountSideBySide(figure: HTMLElement, demo: Demo) {
  figure.classList.add('td-wide');
  const frame = el(figure, 'td-frame td-panes glass-bevel');
  const replay = document.createElement('button');
  replay.className = 'td-replay';
  replay.type = 'button';
  replay.textContent = 'Replay';
  const stages = demo.modes.map((label, i) => {
    const pane = el(frame, 'td-pane');
    const head = el(pane, 'td-pane-head');
    el(head, 'td-pane-label', label);
    if (i === demo.modes.length - 1) head.append(replay);
    const stage = el(pane, 'td-stage td-stage-scrolling');
    stage.dataset.scroll = 'always';
    stage.style.setProperty('--td-height', `${demo.height}px`);
    el(pane, 'td-composer glass-bevel', 'Reply…');
    return { stage, refollow: followBottom(stage) };
  });
  const caption = document.createElement('figcaption');
  caption.textContent = demo.caption;
  figure.append(caption);

  let run: Run | null = null;
  function start() {
    if (run) run.live = false;
    const current = new Run();
    run = current;
    Promise.all(
      stages.map(({ stage, refollow }, mode) => {
        stage.innerHTML = '';
        refollow();
        return demo.play(current, el(stage, 'td-scroll'), mode, stage);
      }),
    ).catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
  }

  replay.addEventListener('click', start);
  const seen = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        start();
      }
    },
    { threshold: 0.6 },
  );
  seen.observe(figure);
}

export function mountTranscriptDemos() {
  document.querySelectorAll<HTMLElement>('figure[data-demo]').forEach(mount);
}
