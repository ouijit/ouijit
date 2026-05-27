/**
 * OSC 133 prompt-mark parsing. Sequences are emitted by our shell-integration
 * scripts:
 *   - ;A — prompt start (terminal is idle, ready for input)
 *   - ;C — command about to run (terminal is busy)
 *   - ;D;<exit_code> — command finished, with exit code
 * ST is either BEL (\x07) or ESC \\.
 *
 * Exit codes outside POSIX's plausible range (signals as negatives, statuses
 * 0–255) are dropped — the parser is the trust boundary between raw PTY bytes
 * and renderer state, and an OSC-injected `99999999` shouldn't be coerced into
 * a meaningful "error" verdict.
 */

export type Osc133Event = { kind: 'A' } | { kind: 'C' } | { kind: 'D'; code: number };

const OSC_133_REGEX = /\x1b\]133;([ACD])(?:;(-?\d+))?(?:\x07|\x1b\\)/g;

/** Parse all OSC 133 prompt-mark events in order. */
export function parseOsc133Events(data: string): Osc133Event[] {
  const events: Osc133Event[] = [];
  for (const match of data.matchAll(OSC_133_REGEX)) {
    const kind = match[1] as 'A' | 'C' | 'D';
    if (kind === 'A' || kind === 'C') {
      events.push({ kind });
      continue;
    }
    if (match[2] == null) continue;
    const code = parseInt(match[2], 10);
    if (!Number.isFinite(code) || code < -255 || code > 255) continue;
    events.push({ kind: 'D', code });
  }
  return events;
}

/** Back-compat helper used by the runner panel — extracts just exit codes. */
export function parseOsc133ExitCodes(data: string): number[] {
  return parseOsc133Events(data)
    .filter((e): e is { kind: 'D'; code: number } => e.kind === 'D')
    .map((e) => e.code);
}

type Osc133Summary = 'thinking' | 'ready' | 'running' | 'success' | 'error';

export type Osc133Transition = { kind: 'exit'; code: number } | { kind: 'enterRunning' } | { kind: 'leaveRunning' };

/**
 * Decide which state transitions a batch of OSC 133 events should drive,
 * given the current summary state. Pure function so the rules are testable
 * without instantiating an OuijitTerminal.
 *
 * Priority rules:
 *   - ;C only enters `running` when not already `thinking`/`running` (agent
 *     activity wins over shell command tracking).
 *   - ;A only flips `running` → `ready`, so a success/error verdict from a
 *     prior ;D stays visible until the next ;C.
 *   - ;D always fires; the caller routes it through its exit-state handler,
 *     which will land on `success` or `error`.
 */
export function planOsc133Transitions(events: Osc133Event[], currentSummary: Osc133Summary): Osc133Transition[] {
  const plans: Osc133Transition[] = [];
  let s: Osc133Summary = currentSummary;
  for (const event of events) {
    if (event.kind === 'D') {
      plans.push({ kind: 'exit', code: event.code });
      s = event.code === 0 ? 'success' : 'error';
    } else if (event.kind === 'C') {
      if (s !== 'thinking' && s !== 'running') {
        plans.push({ kind: 'enterRunning' });
        s = 'running';
      }
    } else if (event.kind === 'A') {
      if (s === 'running') {
        plans.push({ kind: 'leaveRunning' });
        s = 'ready';
      }
    }
  }
  return plans;
}
