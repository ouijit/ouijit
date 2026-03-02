/**
 * Ouijit Demo Recorder
 *
 * Paste this entire script into the Electron app's devtools console.
 * It loads rrweb, starts recording, and exposes helpers to drive the UI.
 *
 * Usage:
 *   1. Paste this script
 *   2. Call: await demo.run()        — runs the scripted flow
 *      Or:   demo.startManual()      — record your own actions, then demo.stop()
 *   3. A recording.json file downloads automatically when done
 *
 * Edit the flow() function at the bottom to change what gets recorded.
 */

(async function () {
  // --- Load rrweb ---
  if (!window.rrweb) {
    const res = await fetch('https://cdn.jsdelivr.net/npm/rrweb@2.0.0-alpha.20/dist/rrweb.umd.cjs');
    const code = await res.text();
    new Function(code).call(window);
    console.log('[demo] rrweb loaded');
  }

  const events = [];
  let stopFn = null;

  function startRecording() {
    events.length = 0;
    stopFn = rrweb.record({
      emit(event) { events.push(event); },
      recordCanvas: true,
      sampling: {
        canvas: 4,
        mousemove: false,
        mouseInteraction: true,
      },
    });
    console.log('[demo] recording started');
  }

  function stopRecording() {
    if (stopFn) { stopFn(); stopFn = null; }
    console.log(`[demo] recording stopped — ${events.length} events`);
  }

  function download() {
    const blob = new Blob([JSON.stringify(events)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'recording.json';
    a.click();
    console.log(`[demo] downloaded recording.json (${(blob.size / 1024).toFixed(0)} KB)`);
  }

  // --- Animation helpers ---

  let mouseX = 0, mouseY = 0;

  // Smooth mouse move to (x, y) over duration ms
  function moveTo(x, y, duration = 400) {
    return new Promise(resolve => {
      const startX = mouseX, startY = mouseY;
      const steps = Math.max(1, Math.ceil(duration / 16));
      let i = 0;
      const iv = setInterval(() => {
        i++;
        const t = i / steps;
        // ease-out cubic
        const e = 1 - Math.pow(1 - t, 3);
        const cx = startX + (x - startX) * e;
        const cy = startY + (y - startY) * e;
        const el = document.elementFromPoint(cx, cy);
        if (el) {
          el.dispatchEvent(new MouseEvent('mousemove', {
            clientX: cx, clientY: cy, bubbles: true, composed: true,
          }));
        }
        if (i >= steps) {
          clearInterval(iv);
          mouseX = x; mouseY = y;
          resolve();
        }
      }, 16);
    });
  }

  // Move to element center and click it
  async function clickEl(selector, opts = {}) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) { console.warn('[demo] not found:', selector); return; }
    const rect = el.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await moveTo(x, y, opts.moveMs || 400);
    await wait(opts.preClick || 80);
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    await wait(60);
    el.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
    el.click();
    await wait(opts.postClick || 300);
  }

  // Type text character by character into the focused element
  async function typeText(text, charDelay = 50) {
    for (const ch of text) {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      document.activeElement?.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
      // For input/textarea elements
      if (document.activeElement?.value !== undefined) {
        document.activeElement.value += ch;
        document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await wait(charDelay + Math.random() * 30);
    }
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // --- Scripted flow ---
  // Edit this function to change the demo recording.

  async function flow() {
    // Example flow — replace with your actual sequence:
    //
    // await wait(500);
    // await clickEl('.some-button');
    // await wait(1000);
    // await clickEl('.another-element');
    //
    // Useful selectors to explore:
    //   .kanban-card          — task cards
    //   .kanban-column        — board columns
    //   .terminal-card        — terminal cards
    //   .new-task-btn         — new task button
    //
    // Tips:
    //   - Keep it under 15 seconds total
    //   - Add wait() between actions so viewers can follow
    //   - Use clickEl with CSS selectors or DOM elements
    //   - moveTo(x, y) for hover effects without clicking

    console.log('[demo] flow started — edit flow() in record.js to customize');
    await wait(3000);
    console.log('[demo] flow finished');
  }

  // --- Public API ---

  window.demo = {
    // Run the scripted flow with recording
    async run() {
      startRecording();
      await wait(500); // let rrweb capture initial snapshot
      await flow();
      await wait(500);
      stopRecording();
      download();
    },

    // Manual mode
    startManual() { startRecording(); },
    stop() { stopRecording(); download(); },

    // Helpers available for console use
    moveTo,
    clickEl,
    typeText,
    wait,
    events,
  };

  console.log('[demo] ready — run demo.run() or demo.startManual()');
})();
