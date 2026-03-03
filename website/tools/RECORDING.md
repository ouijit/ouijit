# Recording a Demo

Record the rrweb demo that plays on the landing page.

## Setup

1. Run the app in dev mode: `npm run start`
2. Set up the state you want to record from (e.g. enter a project, open the kanban board, create some tasks)
3. Open devtools: `Cmd+Option+I`

## Record

1. Paste the contents of `website/tools/record.js` into the devtools console
2. You'll see `[demo] ready`
3. Run one of:

**Manual mode** (recommended) — you control the mouse and perform actions yourself:

```js
demo.startManual()
// ... do your thing ...
demo.stop()
```

**Scripted mode** — runs the `flow()` function in `record.js`:

```js
await demo.run()
```

Both modes automatically download `recording.json` when done.

## Install the Recording

Move the downloaded file into the website assets:

```sh
mv ~/Downloads/recording.json website/assets/recording.json
```

## Preview

```sh
npx serve website
```

Open http://localhost:3000 — the recording plays in the demo player.

## Tips

- **Keep it under 15 seconds.** The demo loops, so shorter is better.
- **Start from the state you want frame 1 to show.** rrweb captures a full DOM snapshot when recording starts, so whatever's on screen becomes the opening frame.
- **Mouse movement is captured** via rrweb's `mouseInteraction` sampling. Move deliberately — the replay cursor (macOS arrow style) follows your real cursor.
- **Resize the window first** if you want specific dimensions. The player reads the recording's native size from the metadata event and scales to fit.
- **The player shows a macOS arrow cursor**, not rrweb's default dot. No mouse trail. Configured in `website/js/demo.js`.

## Console Helpers

After pasting `record.js`, these are available on `window.demo`:

| Helper | Description |
|---|---|
| `demo.startManual()` | Start recording (manual mode) |
| `demo.stop()` | Stop recording + download JSON |
| `demo.run()` | Run scripted flow + download |
| `demo.moveTo(x, y, ms)` | Animate cursor to coordinates |
| `demo.clickEl(selector)` | Move to element + click |
| `demo.typeText(text, delay)` | Type into focused element |
| `demo.wait(ms)` | Promise-based delay |
| `demo.events` | Raw event array (for inspection) |
