---
title: What makes an agent chat feel good?
description: How to show an agent's work without spending the reader's attention
date: 2026-11-10
cover:
  field: { wash: graphite, angle: 160 }
  shape: { kind: circle, wash: prism, angle: 60, cx: 820, cy: 260, r: 250 }
  system: { motif: rows, breakAt: 560, x1: 740 }
---

A single agent turn can produce thoughts, tool calls, remarks and a reply, requiring careful emphasis to preserve the reader's attention. Getting that emphasis right is what makes a chat feel good, and it means three things: the reader knows what the agent is doing, their eye goes only where it's needed, and each piece arrives where and when they expect it.

## Show the agent's progress on one line

A transcript feels rushed when many things move at once, even if little text arrives. Anything that appears or starts moving pulls the eye,[^yantis] so each one costs attention.

While a turn runs, show one status line that says what the agent is doing, drawn from its tool calls, thinking and short remarks, replaced in place. A wait the reader can explain feels shorter than one they can't,[^maister] and people prefer seeing progress to waiting without it.[^myers]

<figure data-demo="kinds"></figure>

The status line moves too, so give each phrase time to be read. Subtitles solve the same problem. In an eye-tracking study, most viewers kept up with subtitles at 20 characters a second, the fastest speed it tested,[^szarkowska] and Netflix uses that as its limit for adult programmes.[^netflix] Step phrases like "Reading src/auth/session.ts" run 20 to 40 characters, so one to two seconds each. Hold each phrase that long. If more steps came and went while it was up, show only the latest one when the hold ends. A phrase replaced before it can be read costs attention and tells the reader nothing.

<figure data-demo="status"></figure>

## Stream replies and collapse the agent's work

Messages written for the reader stream into the transcript during the turn and stay there. Size is a decent test of which messages those are. Check it as the text grows. A message stays on the status line until it passes about 220 characters or picks up structure, like a paragraph break, a list, a heading or code. From then on it streams from its first character. A short remark like "Next I'll check where the expiry is set" never gets past the status line. When the turn ends, the status line gives way to a fold: one closed line holding everything the agent did, above the reply. That's progressive disclosure: what the reader needs now is on the page, and the rest is one click away.[^disclosure] The turn's final message is its reply and always shows, but nothing is known to be last until the turn ends, so a short reply appears then.

Size is a heuristic, and 220 is tuned by eye. It fails both ways. An agent that narrates in long paragraphs streams its narration, and one that answers in a line keeps its answer back until the turn ends. Nothing in the agent's output marks a remark apart from an answer, so the fix is in the instructions: tell the agent to keep remarks between steps short and to put results in its reply rather than its thinking.

## Reveal streamed text evenly

Streamed text doesn't arrive at an even pace. It comes in chunks of very different sizes, and some agents only send a message once it's finished. Uneven chunks look like stutter even when the average speed is fine. Revealing the text smoothly fixes that. The reveal never runs slower than a floor or faster than a ceiling. In between, it speeds up the further behind it falls, aiming to clear its backlog within a catch-up target. The floor and the target decide how far the screen trails the agent. The table shows a 1,000-character message that arrives all at once, with rates in characters per second (cps).

| | Floor | Ceiling | Catch-up target | Fully shown after |
|---|---|---|---|---|
| Slow | 35 cps | 120 cps | 6 s | 15.7 s |
| Fast | 120 cps | 400 cps | 1 s | 3.7 s |

With the slow settings, a hosted agent feels as slow as a model running on your laptop. Pacing only has to even out bursts. Once it keeps the reader waiting after the agent has finished, it's holding back text they could already be reading.

<figure data-demo="pacing"></figure>

How far the text advances each frame also matters. Advance it by a few characters on every frame. A word at a time makes the step size change with every word, which the eye notices for the same reason it notices bursts. In one study of scrolling text, comprehension dropped when it advanced in the largest steps, and readers preferred it moving smoothly.[^kang] At 120 cps and 60 frames a second, that's 2 characters a frame.

<figure data-demo="clicky"></figure>

The eye anticipates motion it can predict.[^kowler] At an even rate, the end of the text and each new line arrive where and when the reader expects them. Bursts break both: the end jumps, and several lines arrive at once, pushing what the reader was reading up in one jump.

Order needs pacing too. People read top to bottom and expect the screen to fill the same way. When something lower down finishes first, the eye jumps to it and then back up to find its place. Pace the whole transcript as one queue, folds included: nothing past a message shows until that message has caught up. Indicators outside the transcript, like an unread badge or the tab title, don't wait.

<figure data-demo="queue"></figure>

## Auto-scroll only while the reader is at the bottom

Keep the view at the bottom while the reader is there, and stop the moment they scroll up to reread something. Decide that from what the reader did. New content also pushes the bottom away, so the view can fall short of it without the reader moving. Only their own scroll up should stop the auto-scroll, and coming back to the bottom should start it again.

## Judge changes in motion, against real transcripts

- Judge every change in motion, at the agent's real speed. None of this shows in a screenshot or a code review.
- Run one fixed prompt every time, written to exercise everything your transcript can show.

Complaints about feel are vague, and the same word can have several causes. "Too fast" might mean the text arrives in bursts, the reveal outruns reading, or too many things move at once, and each has a different fix. Treat the complaint as a symptom: list what could be causing it, find a number for each, and change one while watching whether the complaint goes away. The numbers also catch overcorrection, which is hard to see by feel. Slowing the reveal makes "too fast" go away, and the "fully shown after" figure shows it has become "too slow".

Mock up changes using a real transcript, word for word, before building them. A made-up transcript is tidier than a real one, so it hides costs.

[^kang]: Kang and Muter, [Reading dynamically displayed text](https://web-archive.southampton.ac.uk/cogprints.org/1971/1/Abs1989.htm), *Behaviour & Information Technology*, 1989.

[^kowler]: Kowler, Rubinstein, Santos and Wang, [Predictive smooth pursuit eye movements](https://researchwith.njit.edu/en/publications/predictive-smooth-pursuit-eye-movements/), *Annual Review of Vision Science*, 2019.

[^maister]: David Maister, [The Psychology of Waiting Lines](https://davidmaister.com/articles/1/52/), 1985.

[^myers]: Brad Myers, [The importance of percent-done progress indicators for computer-human interfaces](https://doi.org/10.1145/317456.317459), CHI '85.

[^disclosure]: Jakob Nielsen, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/), Nielsen Norman Group, 2006.

[^netflix]: Netflix, [English (USA) Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide), reading speed limits.

[^szarkowska]: Szarkowska and Gerber-Morón, [Viewers can keep up with fast subtitles: Evidence from eye movements](https://pmc.ncbi.nlm.nih.gov/articles/PMC6007935/), *PLOS ONE*, 2018.

[^yantis]: Yantis and Jonides, [Abrupt visual onsets and selective attention: Evidence from visual search](https://doi.org/10.1037/0096-1523.10.5.601), *Journal of Experimental Psychology: Human Perception and Performance*, 1984.
