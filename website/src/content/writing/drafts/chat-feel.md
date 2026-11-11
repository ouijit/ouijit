# What makes a chat feel good: notes from Chat's transcript

Raw material for a post (task 607). It records what was tried on the Chat page's
transcript on 2026-11-10, in order: what Prentice saw and said, what was wrong
underneath, what changed, and the commit. Every step is a commit on
`chat-605`, so each version can be checked out and run again.

The test bed throughout was the same QA prompt: ten steps that make Chat
format a reply, run commands, hit a refusal, start a worker, wait on it, and
ask for three decisions. A replay plan for the post is at the end.

## The starting point

`28b514ba`. Each stretch of work between two things Chat said folded to one
grey line ("Ran 3 commands"). The stretch still running stayed open, and
closed once Chat spoke. A thought counted as work. Wakes ("Ouijit: …") were
grey lines of their own. Cards appeared only for decisions.

## 1. Steps vanish, thoughts are empty

> "i feel i didnt see basically any of the special bevel card components … also, thoughts all seem to be empty after the fact?"
>
> "it seems like nothing is rendering or remained visible for steps 3 and 4? the transcript just jumps from 2 to 5"

What was underneath:

- Chat announced steps 3 and 4 only in its thinking. A thought counted as
  work, so everything from step 2 to step 4 became one "Ran 6 commands" fold.
- The running stretch opened itself and snapped shut when Chat spoke, which
  read as content being replaced.
- Claude Code sends thinking blocks with no text unless the session asks for
  summaries (`--thinking-display summarized`; checked against the CLI both
  ways). Every empty thought still made a row.
- The cards were there by design only for decisions, and the run had not
  reached one yet.

Change, `2ca32290`: ask Claude for thinking summaries; hide empty thoughts;
show a thought as a grey line where it happened, splitting folds; tell Chat to
put results in its reply rather than its thinking.

## 2. Too much, too many kinds of thing

> "the chat message ui coming back and leftover from the chat agent is overly... complex? lots of stuff with different formatting etc, which made the response feel like it was moving really fast and hard to follow"

Counted on the second QA run: 35 pieces in one conversation. 12 thought
lines, 7 folds, 7 wake messages, 9 replies, plus headings, tables, code and
cards. Each type streamed in and reflowed the page. The motion read as speed.

Step 1 made this worse: the grey thought lines added a whole new kind of
thing in motion.

Mocked before building: the design canvas board "QA run, two ways" put that
exact transcript beside the proposal, same words
(https://claude.ai/artifact/531a2PpvJRZh5JBi4ZNy5E). The proposal: one fold
per turn, only the turn's last reply as prose, wakes as captions, answered
decisions as one line, one status line while working. The board named its
own cost: Chat's step 1 reply ended up inside a fold.

> "ok its ts a little shortber but i may need to see it actually live to understand if it feels eassier to follow"
>
> "things wont be expanded while theyre happening right? its important that it feels much more like its just thinking/responding vs running through tons of stages etc then only appearing collapsed after."

That second line is the brief the rest of the work kept to.

Change, `d49956b5`: a turn at a time. While it runs, one grey line says what
Chat is doing, replaced in place and held 1.5 s per phrase. Once it ends, one
closed fold and the last reply. Headings render at body size. Wakes carry a
line for the reader alongside the text for the agent: what the user did as a
check line ("You moved QA worker to done"), what happened as a caption.

## 3. Better, but it flip-flops and lands in blocks

> "still not the right balance but still an improvement. issues: it no longer is using my special thinking icon; it kept switching bettween thinking/doing thing which was dumb; when it finished, suddenly tons of text appeared followed by prompts, then responding to those prompts more text appeared in a jarring way"
>
> "a reply should still stream, just more intelligently"

What was underneath:

- The status line fell back to "Thinking…" whenever a command finished, so it
  alternated between that and the next step.
- The plain pulse dot had replaced the app's own thinking glyph.
- Withholding every message until the turn ended meant the reply arrived as a
  wall, all at once.

Change, `d561fa35`: the line keeps the latest step or finished thought, held
2 s, and says "Thinking…" only before there is anything. The glyph is back.
A message with substance streams where it is said and stays: a paragraph
break, a list, a heading, code or more than about 220 characters. Short
remarks ("Next I'll check the sessions") only name the step on the status
line, then fold. The last reply always shows. Nothing seen is put away.

## 4. Pacing: too fast, then too slow

> "there were still times where it seems like blocks of content appeared faster than is preferrable. maybe there is a best practice around limiting the stream rendering speak"

Agents send text in bursts, and a message that arrives finished lands in one
frame. The established fix is smoothing: buffer the text and reveal it at an
even rate, catching up when far behind.

`f1a8c4ae`: floor 35 characters per second (near reading speed), ceiling 120,
catch up within 6 s. Measured: a 970-character reply finished revealing 13 s
after Chat had finished writing.

> "nope thats too slow, feels sluggish like im doing local inference"

The lesson: pacing is for evening out bursts, never for slowing the agent
down. Reading speed is the wrong floor.

`0f38ecb1`: floor 90, ceiling 400, catch up within 1.5 s. Measured: about
220 characters per second while streaming, done 2.8 s after Chat.

## 5. Out of order

> "there is something not being accounted for where multiple sections can appear and an earlier section is continueing to stream after a later one is done?"

Each message paced itself independently, and folds, the status line and wake
lines appeared the instant they existed.

`aee0f88b`: one queue in transcript order. Nothing after a message still
being revealed is shown until it catches up. Checked live: the first part
revealed to its end (922 characters) before the status line, the fold and the
second part appeared.

## 6. Clicky

> "one thing that stands out is that the streaming is 'clicky'. maybe because its not smooth by character but jumping by word or token?"

The reveal advanced a whole word at a time, so long words landed as jumps.

`d40c6bfe`: a character at a time, every frame; floor raised to 120, catch up
within 1 s. Measured: 180 of 181 frames moved, 2 characters per frame
typically, never more than 3.

## 7. Losing the bottom

> "maintaining the scroll the bottom as content appears doesnt sustain … when i scrolled down to see more content had appeared aftre the step that was positioned as last in the scroll view"

The view decided whether the reader was at the bottom from every scroll
event, including the one its own following caused. That event lands a frame
later. If a fold and a paragraph arrived together in between, the view saw
itself more than 48 px from the bottom, read that as the reader scrolling
away, and stopped following.

`a97ee17e`: only a scroll upward lets go. Browser scroll anchoring is off on
the transcript, and the view follows the scroller's own height as well as the
content's. Measured over three long sections with commands between them: never
more than 1 px from the bottom.

> "ok that felt pretty good."

## What it adds up to

- Motion reads as speed. The number of kinds of thing moving matters more
  than the amount of text.
- Never show work happening and then take it away. Either it stays, or it
  was never shown.
- A working indicator should name one thing and hold it long enough to read.
  Flipping back to a generic state is worse than staying put.
- Stream what is said to the reader; fold what is done. Size is a decent
  proxy for which is which.
- Pace to smooth bursts, not to slow the agent. A reading-speed floor feels
  like local inference.
- One reveal queue for the whole transcript. Order on screen must match order
  of speech.
- Smooth means every frame, per character. Per word clicks.
- Stick to the bottom on intent, not on distance. Only the reader scrolling up
  should break it.
- Mock with the user's own transcript. The comparison board made the
  trade-offs concrete before any code moved.

## Material on hand

- Commits: `28b514ba` (start), `2ca32290`, `d49956b5`, `d561fa35`,
  `f1a8c4ae`, `0f38ecb1`, `aee0f88b`, `d40c6bfe`, `a97ee17e` on `chat-605`.
- The two QA conversations, in this worktree's dev database
  (`node scripts/dev-db.mjs path`, here `~/Library/Application Support/ouijit-dev-15ab3c85/ouijit.db`),
  sessions `home-1794372995395-d6scjof` and `home-1794373704380-1pbsnqx`.
  They hold the nodes, not the timing of each streamed chunk.
- The canvas board "QA run, two ways".
- The QA prompt itself, which made a good stress test.

## Replaying the versions

The post wants each version shown moving, on the same conversation. Every
version renders the same event stream: the host's sequenced chat events,
unchanged in shape across these commits apart from wake `notes`, which older
versions ignore. So:

1. Record once. Capture one real Chat conversation's sequenced events with
   wall-clock offsets, including every streamed delta, into a JSON file. The
   stored transcripts above lack the delta timing, so this needs a fresh run
   of the QA prompt with a recorder on.
2. Replay anywhere. A dev-only page, or a Playwright script, feeds the events
   into the chat store at their recorded offsets and renders the Chat page.
3. Run it at each commit. A worktree per commit, the same recording, a
   Playwright screen recording of each, cut side by side.
