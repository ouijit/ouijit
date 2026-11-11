---
title: What makes a chat interface feel good?
description: An agent's chat feels good when its transcript is easy to follow. What to show, when, and how fast, with numbers.
date: 2026-11-10
cover:
  field: { wash: graphite, angle: 160 }
  shape: { kind: circle, wash: prism, angle: 60, cx: 820, cy: 260, r: 250 }
  system: { motif: rows, breakAt: 560, x1: 740 }
---

A single agent turn can produce thoughts, tool calls, remarks and a reply, requiring careful emphasis to preserve the user's attention. Streamed as they arrive, they reflow the page so often that the agent looks faster than it is, and the reader can't keep up.

If your client speaks the [Agent Client Protocol](https://agentclientprotocol.com), each rule below is a decision about one update type, made once for every agent behind it.

## Count the kinds of thing that move

Motion reads as speed. The eye is drawn to anything that moves, whether or not it matters, so every moving element costs a little attention. A transcript feels rushed because of how many different kinds of thing are moving, more than because of how much text arrives. A thought line, a growing list of commands, a card and a streaming reply each move differently, and the eye follows every one.

Cut the kinds before the amount. While a turn runs, show one status line that says what the agent is doing, replaced in place. When the turn ends, show its work as one collapsed line, a fold, already closed, and the reply. A fold that opens while the work runs and snaps shut when the agent speaks reads as content being replaced. Anything that vanishes from the screen looks like an error, or like something the reader was meant to catch and missed. The status line still names what the agent is on within two seconds of it starting, so you can interrupt the agent without waiting for the turn to end.

<figure data-demo="kinds"></figure>

The status line moves too. Hold each phrase for at least 2 seconds, a figure tuned by eye, skipping any that came and went in between, and keep the latest step up when a command finishes. Falling back to "Thinking…" between steps makes the line flicker between two states. A label that keeps changing its mind comes across as indecisive, and the reader stops trusting what it says.

<figure data-demo="status"></figure>

## Stream what's said, fold what's done

Holding every message until the turn ends lands the reply as a wall, with any decisions right behind it. A wall has no reading order: the eye lands somewhere in the middle and has to go back up to find the start. Some messages have to stream during the turn, and size is a decent test of which. Check it as the text grows. A message stays on the status line until it passes about 220 characters or picks up structure, like a paragraph break, a list, a heading or code. From then on it streams in place from its first character and stays. A short remark like "Next I'll check the sessions" never gets past the status line, and folds with the work. The turn's last reply always shows, but nothing is known to be last until the turn ends, so a short final reply appears then.

Size is a heuristic, and 220 is tuned by eye. It fails both ways. An agent that narrates in long paragraphs streams its narration, and one that answers in a line keeps its answer back until the turn ends. Nothing in the agent's output marks a remark apart from an answer, so the fix is in the instructions: tell the agent to keep remarks between steps short and to put results in its reply rather than its reasoning.

Thinking feeds the status line too, when there is any to read. Some agents send thinking with no text unless asked for summaries; Claude Code, for one, needs `--thinking-display summarized`.

## Pace to smooth bursts, not to slow down

Agents send text in bursts, and a message that arrives whole lands in a single frame. The eye follows steady motion easily and notices every change in its rate, so bursts look like stutter even when the average speed is fine. Revealing the text at an even rate fixes that, catching up faster the further behind it falls, and where the floor sits decides how far the screen trails the agent. For a 1,000-character message that arrives all at once, in characters per second (cps):

| | Floor | Ceiling | Catch up within | Fully shown after |
|---|---|---|---|---|
| Reading speed | 35 cps | 120 cps | 6 s | 15.7 s |
| Smoothed, lower floor | 90 cps | 400 cps | 1.5 s | 4.7 s |
| Smoothed | 120 cps | 400 cps | 1 s | 3.7 s |

At reading speed, a hosted agent feels as slow as a model running on your laptop. The floor only has to even out bursts. Set it to make the reader wait after the agent has finished, and it becomes a brake.

<figure data-demo="pacing"></figure>

Move something every frame. Advancing a word at a time makes long words land as jumps, which reads as clicking. At 120 cps and 60 frames a second, a reply advances 2 characters a frame.

<figure data-demo="clicky"></figure>

Pacing also creates an ordering problem. When each message owns its reveal, which is the natural way to write it in a component framework, a long message that arrived first can still be revealing after a short one below it has finished. Anything not paced, like a fold or a decision card, appears the instant it exists, below words that haven't arrived yet. People read top to bottom and expect the screen to fill the same way. When the bottom finishes first, the eye jumps down to the newest thing and then back up to the middle. Pace the transcript as one queue: nothing past a message shows until that message has caught up. Badges outside the transcript, like a waiting count in the title bar, don't wait.

<figure data-demo="queue"></figure>

## Follow the bottom on intent, not distance

Scroll position belongs to the reader. A view that moves after they've scrolled away, or stops following when they haven't, feels like the app fighting them. A transcript that follows new content has to tell the reader scrolling away from its own scrolling. Checking the distance to the bottom on every scroll event gets this wrong. The scroll event the view's own follow causes lands a frame later, and if a fold and a paragraph arrived in that frame, the view finds itself more than 48 px from the bottom, treats that as the reader leaving, and stops following. New content then piles up out of sight.

Compare `scrollTop` with its value at the last scroll event instead, and let go only when it went down. New content never moves `scrollTop` up. Browser scroll anchoring can, so turn it off on the transcript with `overflow-anchor: none`. Pin again whenever the reader comes back within 48 px of the bottom. Follow from a `ResizeObserver` on both the content and the scroller, so text revealed between events, and a scroller that changes height, both keep the view down. With that, the view stays within a pixel of the bottom across long sections with commands between them.

## Tuning the feel

None of the problems above show up in a screenshot or a code review. They only show up in motion, at the agent's real speed, so judge every change by watching it run.

Use one fixed prompt for every run, so the interface is the only thing that changes. It has to make the agent format a reply, think, run a string of commands including a long one, hit an error, and ask for permission. Change one thing per run. Two changes at once make it impossible to tell which one helped.

Put what feels wrong into plain words first, like "too fast", "clicky" or "jumpy", then find the number behind it: characters per second, seconds behind the agent, characters per frame, pixels from the bottom. The words find the problem, and the number tells you when it's fixed and stops you overcorrecting. The reading-speed floor in the table above is what overcorrecting "too fast" looks like.

Mock a proposal against a real run's exact transcript, word for word, before building it. A real transcript shows costs a made-up one hides, like a step's only reply ending up inside a fold.

## Mapped to ACP

ACP reduces every agent to the same few updates, so the rules above come down to one table:

| ACP update | While the turn runs | Once it ends |
|---|---|---|
| `agent_thought_chunk` | Its first finished sentence on the status line | In the fold |
| `tool_call`, `tool_call_update` | Its title on the status line | In the fold |
| `agent_message_chunk`, short | Its first sentence on the status line | In the fold, unless it was the last message |
| `agent_message_chunk`, over 220 characters or structured | Streams in place | Stays |
| `session/request_permission` | A card, after the text before it | One line, once answered |

Chunks that share a `messageId` are one message. Agents may leave the ID out, and then a message is the run of `agent_message_chunk` updates until a different update arrives. The turn ends when the `session/prompt` request returns its `stopReason`, and only then can a short last message be told apart from a remark. ACP has no field that marks a message as a remark or as the answer, so the size rule is a guess every ACP client has to make.
