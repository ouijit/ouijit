---
title: What makes an agent chat feel good?
description: How to show an agent's work without spending the reader's attention
date: 2026-11-11
draft: true
cover:
  field: { wash: graphite, angle: 160 }
  shape: { kind: circle, wash: prism, angle: 60, cx: 820, cy: 260, r: 250 }
  system: { motif: rows, breakAt: 560, x1: 740 }
---

Agent responses often include much more data than just their reply, so a chat has to decide what to emphasize. Getting that emphasis right is what separates a conversation from a log, and it means three things: the reader knows what the agent is doing, their eye goes only where it's needed, and each piece arrives where and when they expect it.

## Progress belongs on one line

A transcript feels rushed when many things move at once, even if little text arrives. Anything that appears or starts moving pulls the eye,[^yantis] so each one costs attention.

While a turn runs, one status line should say what the agent is doing, updating in place from its tool calls, thinking and short remarks. Knowing what's happening makes the wait feel shorter.[^maister]

<figure data-demo="kinds"></figure>

The status line moves too, so each phrase should stay up long enough to be read. Subtitles solve the same problem. In an eye-tracking study, most viewers kept up with subtitles at 20 characters a second, the fastest speed it tested,[^szarkowska] and Netflix uses that as its limit for adult programs.[^netflix] Step phrases like "Reading src/auth/session.ts" run 20 to 40 characters, so each should stay up for one to two seconds. If more steps happen in that time, the line skips to the latest. A phrase replaced before it can be read costs attention and tells the reader nothing.

<figure data-demo="status"></figure>

## Everything except the agent's replies should collapse

During a turn, the reader should see what the agent is doing and anything it wrote for them. Short remarks between steps belong on the status line. Longer messages, or ones with a list, heading or code, are written for the reader, so they should stream into the transcript and stay there.

When the turn ends, the reader should see the reply, with everything the agent did folded into one closed line above it. That's progressive disclosure: what the reader needs now is on the page, and the rest is one click away.[^disclosure]

## Text should reveal steadily instead of in bursts

Agents don't send text at an even pace. It comes in chunks of very different sizes, and some agents only send a message once it's finished. Uneven chunks look like stutter even when the average speed is fine. The fix is to hold text back and reveal it at a smooth pace instead of as it arrives.

The more text is waiting, the faster it should reveal, aiming to clear the backlog within a set time, the catch-up target. A minimum rate, the floor, keeps the last few characters from crawling, and a maximum, the ceiling, keeps a big chunk from arriving as a jump. The cost is that the screen trails the agent, and these three settings decide by how much. The table shows it for a 1,000-character message that arrives all at once, with rates in characters per second (cps).

| | Floor | Ceiling | Catch-up target | Fully shown after |
|---|---|---|---|---|
| Slow | 35 cps | 120 cps | 6 s | 15.7 s |
| Fast | 120 cps | 400 cps | 1 s | 3.7 s |

With the slow settings, a hosted agent feels as slow as a model running on your laptop. Pacing only has to even out bursts. Once it keeps the reader waiting after the agent has finished, it's holding back text they could already be reading.

<figure data-demo="pacing"></figure>

It also matters how far the text moves on each frame. A few characters at a time reads as smooth motion: at 120 cps and 60 frames a second, that's 2 a frame. A word at a time makes the step size change with every word, which the eye notices for the same reason it notices bursts. In one study of scrolling text, comprehension dropped when it advanced in the largest steps, and readers preferred it moving smoothly.[^kang]

<figure data-demo="clicky"></figure>

The eye anticipates motion it can predict.[^kowler] At an even rate, the end of the text and each new line arrive where and when the reader expects them. Bursts break both: the end jumps, and several lines arrive at once, shoving the line being read upward.

## The transcript should fill top to bottom

Order needs pacing too. People read top to bottom and expect the screen to fill the same way. When something lower down finishes first, the eye jumps to it and then back up to find its place. The whole transcript should be paced as one queue, folds included: nothing below a message shows until that message has caught up.

<figure data-demo="queue"></figure>

## Auto-scroll should follow the reader

The view should stay at the bottom while the reader is there, and stop following the moment they scroll up to reread something. Only the reader's own scroll should stop it, because new content also pushes the bottom away, so the view can fall short of it without the reader moving. Coming back to the bottom should start it again.

---

Each of these changes is small, but over a whole turn they add up:

<figure data-demo="whole"></figure>

[^kang]: Kang and Muter, [Reading dynamically displayed text](https://doi.org/10.1080/01449298908914536), *Behaviour & Information Technology*, 1989.

[^kowler]: Kowler, Rubinstein, Santos and Wang, [Predictive smooth pursuit eye movements](https://researchwith.njit.edu/en/publications/predictive-smooth-pursuit-eye-movements/), *Annual Review of Vision Science*, 2019.

[^maister]: David Maister, [The Psychology of Waiting Lines](https://davidmaister.com/articles/1/52/), 1985.

[^disclosure]: Jakob Nielsen, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/), Nielsen Norman Group, 2006.

[^netflix]: Netflix, [English (USA) Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide), reading speed limits.

[^szarkowska]: Szarkowska and Gerber-Morón, [Viewers can keep up with fast subtitles: Evidence from eye movements](https://pmc.ncbi.nlm.nih.gov/articles/PMC6007935/), *PLOS ONE*, 2018.

[^yantis]: Yantis and Jonides, [Abrupt visual onsets and selective attention: Evidence from visual search](https://doi.org/10.1037/0096-1523.10.5.601), *Journal of Experimental Psychology: Human Perception and Performance*, 1984.
