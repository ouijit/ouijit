/**
 * Capture rrweb recording as MP4 at retina resolution.
 *
 * Plays the recording in real-time (so CSS transitions/animations work)
 * while capturing 2x screenshots via Playwright. Pipes frames to ffmpeg.
 *
 * Usage: node website/tools/capture.mjs
 * Output: website/assets/demo.mp4
 */

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';
import { resolve, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteDir = resolve(__dirname, '..');

function serve() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  };
  const server = createServer((req, res) => {
    const filePath = resolve(websiteDir, '.' + (req.url === '/' ? '/index.html' : req.url));
    try {
      const data = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const RECORDING_DURATION_MS = 24_200;
const WIDTH = 1050;
const HEIGHT = 643;

async function main() {
  const server = await serve();
  const port = server.address().port;
  console.log(`Serving on http://127.0.0.1:${port}`);

  const cursorSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='23'%3E%3Cpath d='M1.5 1.5l0 19 4.6-4.6 3 6.9 2.5-1-3-6.9H14.5L1.5 1.5z' fill='%23000' stroke='%23fff' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E";

  const playerPage = `<!DOCTYPE html><html><head>
    <style>
      * { margin: 0; padding: 0; }
      body { background: #1C1C1E; overflow: hidden; width: ${WIDTH}px; height: ${HEIGHT}px; }
      .rr-player, .rr-player__frame { background: transparent !important; }
      .replayer-wrapper { background: #1C1C1E !important; }
      .rr-controller { display: none !important; }
      .replayer-mouse {
        background: none !important; border: none !important; border-radius: 0 !important;
        width: 16px !important; height: 23px !important;
        background-image: url("${cursorSvg}") !important;
        background-size: 16px 23px !important; background-repeat: no-repeat !important;
        transition: left 100ms linear, top 100ms linear !important;
        opacity: 0;
      }
      .replayer-mouse::after { display: none !important; }
    </style>
    <link rel="stylesheet" href="/css/rrweb-player.css">
  </head><body>
    <div id="player"></div>
    <script src="/js/rrweb-player.js"><\/script>
    <script>
      fetch('/assets/recording.json').then(r => r.json()).then(events => {
        const Player = window.rrwebPlayer.default || window.rrwebPlayer;
        const player = new Player({
          target: document.getElementById('player'),
          props: {
            events, autoPlay: false, showController: false,
            width: ${WIDTH}, height: ${HEIGHT},
            insertStyleRules: ['html, body, .replayer-wrapper { background: #1C1C1E !important; }'],
            mouseTail: false,
          },
        });
        window.__player = player;
        window.__ready = true;
        // Show cursor once it moves away from (0,0)
        const el = document.querySelector('.replayer-mouse');
        if (el) {
          const obs = new MutationObserver(() => {
            if (parseFloat(el.style.left) > 0 || parseFloat(el.style.top) > 0) {
              el.style.opacity = '1';
              obs.disconnect();
            }
          });
          obs.observe(el, { attributes: true, attributeFilter: ['style'] });
        }
      });
    <\/script>
  </body></html>`;

  const browser = await chromium.launch({
    args: ['--force-device-scale-factor=1'],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.route('**/capture', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: playerPage }));
  await page.goto(`http://127.0.0.1:${port}/capture`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });

  console.log('Player ready, starting real-time capture...');
  await page.waitForTimeout(500);

  const mp4Path = resolve(websiteDir, 'assets', 'demo.mp4');

  // Collect frames in memory during real-time playback
  const frames = [];
  await page.evaluate(() => window.__player.play());

  const start = Date.now();
  while (Date.now() - start < RECORDING_DURATION_MS + 500) {
    const buf = await page.screenshot({ type: 'png' });
    frames.push(buf);
    if (frames.length % 25 === 0) process.stdout.write(`\r  ${frames.length} frames...`);
  }
  const elapsed = (Date.now() - start) / 1000;
  const fps = Math.round(frames.length / elapsed);
  console.log(`\n  Captured ${frames.length} frames in ${elapsed.toFixed(1)}s (~${fps}fps)`);

  await context.close();
  await browser.close();
  server.close();

  // Encode — use actual achieved framerate
  console.log(`Encoding -> demo.mp4`);
  const ffmpegProc = spawn('ffmpeg', [
    '-y', '-f', 'image2pipe', '-framerate', String(fps),
    '-i', '-',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    mp4Path,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  for (const frame of frames) {
    await new Promise((res, rej) => {
      if (!ffmpegProc.stdin.write(frame, (err) => err ? rej(err) : res())) {
        ffmpegProc.stdin.once('drain', res);
      }
    });
  }
  ffmpegProc.stdin.end();
  await new Promise((res, rej) => {
    ffmpegProc.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
  });

  const size = statSync(mp4Path).size;
  console.log(`Done! ${mp4Path} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
