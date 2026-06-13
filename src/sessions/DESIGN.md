# Session model (durability-first firewall)

Status: contract only. `model.ts` defines the shapes; no runtime behavior ships
with task #460. The three follow-on tracks fill it in.

## Why this is a firewall

Three tracks touch terminal sessions at once:

- **#461 renderer port** — reads sessions and their buffers in the renderer.
- **#462 durable sessions** — persists sessions so they survive a full app quit.
- **#463 renderer projection** — mirrors main's sessions into renderer state.

Durability is the unforgiving constraint: stable ids, a serializable record, and
restart survival are painful to retrofit once a buffer format or an id scheme has
shipped. So #462 co-owns this contract, and #463 builds on top of it rather than
inventing its own. Everyone imports `src/sessions/model.ts`.

## Ownership

The **main process owns sessions.** The renderer holds a projection only and
never receives a live `Session` — it gets `SessionSnapshot` (metadata) plus
buffer bytes on demand. State changes flow one way: main → renderer, over the
`session:event` stream.

## Identity and durability

| Concern      | Type        | Lifetime                                            |
| ------------ | ----------- | --------------------------------------------------- |
| Session id   | `SessionId` | Allocated once, persisted, survives a full restart. |
| Live process | `PtyId`     | Ephemeral; reassigned on every (re)spawn.           |

`Session.ptyHandle: PtyId \| null` is the binding between the two. It is `null`
while a session is dormant (rehydrated after a quit, before reattach). This split
is the heart of the contract: the durable identity must not be the process id,
because the process cannot outlive the app.

`DurableSession` is the JSON-serializable record written to disk — primitives,
arrays, and plain objects only, no live handles. The output buffer is referenced
via `DurableBufferRef` (inline chunks or a file pointer) so a large scroll-back is
not inlined into every record. On restart a `DurableSession` rehydrates into a
dormant `Session` (`ptyHandle: null`, `state: 'idle'`, prior state kept only as a
UI hint).

## State machine

Five states, exactly what the renderer renders:

```
        spawn / reattach
  idle ───────────────► running ──────► ready
   ▲                      │  ▲   ▲          │
   │ clean exit           │  │   └──────────┘ command start / prompt
   │                      ▼  │
   └───────────────── awaiting (blocked on user input)
            error ◄── (non-zero exit / crash) ──┘
   error ── respawn ──► idle / running
```

- `idle` — no live process (new, cleanly exited, or dormant after restart).
- `running` — process actively executing / emitting output.
- `awaiting` — process blocked on user input (agent question, `read`, pager).
- `ready` — process idle at an interactive prompt (OSC 133 `D`).
- `error` — process exited non-zero or crashed; record retained until cleared.

`closed` is a **lifecycle event, not a state** — a closed session no longer
exists. `SESSION_STATE_TRANSITIONS` / `canTransition()` are the authoritative
allowed-transition table.

## Event stream (main → renderer)

One discriminated union, `SessionEvent`, on a single push channel
(`session:event`), so per-session ordering across event kinds is preserved:

- `created` — session entered the manager (spawn or rehydration). Carries a snapshot.
- `state-changed` — the state machine advanced (`prev` → `state`).
- `output` — new terminal bytes; `cursor` is the new end offset.
- `resized` — PTY geometry changed.
- `closed` — session removed; `exitCode` is `null` on a forced kill.

## Detach / attach

Three verbs on `SessionManagerApi`, plus close:

- **attach** — bind the renderer and get an `AttachResult` (snapshot + full
  replay + cursor + geometry) to paint a fresh terminal and start a live tail.
  Pure read/subscribe; does not spawn.
- **detach** — unbind the renderer **without killing the process.** The session
  keeps running headless and buffering. Used on renderer reload and when a card
  is closed but the work should continue. (Survives the renderer.)
- **reattach** — bind a dormant, post-restart session to a freshly spawned PTY,
  restoring identity, context, and replay buffer (`idle → running`). (Survives
  the app process.)
- **close** — kill the process and emit `closed`. The durability-critical line is
  detach (keep running) vs. close (terminate).

## Buffer access

`TerminalBuffer` is the one read interface the renderer port (#461) and the
projection (#463) share, so they agree on replay semantics regardless of how #462
stores bytes:

- `readAll()` — full retained scroll-back for an initial replay.
- `readSince(cursor)` — incremental tail; returns the slice and the next cursor.
- `cursor` / `byteLength` / `isAltScreen` — geometry and TUI-mode hints.

`BufferCursor` is a monotonic byte offset; alternate-screen tracking is carried
through so a TUI replay renders correctly.

## Mapping to today's code

`ptyManager.ts` already has most of the runtime; this contract reorganizes it
durably rather than rewriting it:

| Today (`ptyManager.ts`)                      | Contract (`model.ts`)               |
| -------------------------------------------- | ----------------------------------- |
| `PtyId` (from `generateId('pty')`)           | `Session.ptyHandle` (ephemeral)     |
| `ManagedPty`                                 | `Session` (live)                    |
| `ActiveSession`                              | `SessionSnapshot`                   |
| `outputChunks` + `isAltScreen` + `lastCols`  | `TerminalBuffer`                    |
| `pty:data:${id}` / `pty:exit:${id}` channels | `SessionEvent` `output` / `closed`  |
| `reconnectPty()` (renderer reload only)      | `attach` (and `reattach` post-quit) |
| `getActiveSessions()`                        | `SessionManagerApi.list()`          |

Today's `reconnectPty` survives a renderer reload but not a quit (the `PtyId` is
gone). The new split adds the missing axis: a durable `SessionId` plus a
persisted buffer make reattach-after-quit possible.

## What each track builds

- **#461** consumes `SessionSnapshot` + `TerminalBuffer` + `SessionsAPI`.
- **#462** implements `SessionManagerApi`, persists `DurableSession` /
  `DurableBufferRef`, wires the `session:*` IPC handlers, and rehydrates on launch.
- **#463** subscribes to `SessionEvent` and maintains the renderer projection.

## Non-goals for #460

No handlers, no persistence, no renderer wiring — those are #461–#463. The
`session:*` channels exist in the IPC contract as types only and emit nothing
until #462 registers handlers.
