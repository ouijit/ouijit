/**
 * Capture-only HTTP routes. Gated on OUIJIT_CAPTURE_MODE=1 — in production
 * builds these return 404 because `isCaptureMode()` short-circuits the
 * handlers before they read the request.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BrowserWindow } from 'electron';
import { typedPush } from '../ipc/helpers';
import { saveLens } from '../lens/config';
import { postDiffLens } from '../lens/worktreeSubject';
import { isCaptureMode } from './captureMode';
import type { CaptureNavigatePayload } from './types';

const execFileAsync = promisify(execFile);

export interface CaptureHandlerContext {
  window: BrowserWindow;
  body: Record<string, unknown>;
}

/**
 * Stores the grouping under a lens of the payload's name, so the pane opens on
 * it. Nothing here runs an agent: the lens is written straight to where a run
 * would have left it, pinned to the change the fixture just made.
 */
async function stageDiffLens(payload: CaptureNavigatePayload): Promise<void> {
  const staged = payload.diffLens;
  if (!staged || !payload.projectPath) return;
  const lens = await saveLens(payload.projectPath, { name: staged.name, instruction: staged.instruction });
  await postDiffLens(
    {
      projectPath: payload.projectPath,
      worktreePath: staged.worktreePath,
      base: staged.base,
      branch: staged.branch,
    },
    staged.groups,
    lens,
  );
}

export async function handleCaptureNavigate(ctx: CaptureHandlerContext): Promise<{ ok: true }> {
  if (!isCaptureMode()) throw new Error('Capture mode disabled');
  const payload = ctx.body as unknown as CaptureNavigatePayload;
  if (!payload || typeof payload.scene !== 'string') {
    throw new Error('Missing scene in body');
  }
  await stageDiffLens(payload);
  typedPush(ctx.window, 'capture:navigate', payload);
  return { ok: true };
}

/**
 * Navigate + capture in one shot. mode='native' uses macOS `screencapture -l`
 * against the window's CGWindowID (gives drop shadow + traffic lights).
 * mode='content' falls back to webContents.capturePage() (no chrome, but
 * works without Screen Recording permission).
 */
export async function handleCaptureSnapshot(
  ctx: CaptureHandlerContext,
): Promise<{ ok: true; outPath: string; bytes: number; mode: 'native' | 'content' }> {
  if (!isCaptureMode()) throw new Error('Capture mode disabled');
  const body = ctx.body as {
    payload?: CaptureNavigatePayload;
    outPath?: string;
    settleMs?: number;
    mode?: 'native' | 'content';
  };
  if (!body.payload || typeof body.payload.scene !== 'string') {
    throw new Error('Missing payload.scene');
  }
  if (typeof body.outPath !== 'string' || !path.isAbsolute(body.outPath)) {
    throw new Error('Missing absolute outPath');
  }
  const settleMs = body.settleMs ?? 800;
  const mode = body.mode ?? 'native';

  await stageDiffLens(body.payload);
  typedPush(ctx.window, 'capture:navigate', body.payload);
  await new Promise((r) => setTimeout(r, settleMs));

  fs.mkdirSync(path.dirname(body.outPath), { recursive: true });

  if (mode === 'native' && process.platform === 'darwin') {
    // Re-resolve the CGWindowID at capture time in case it rotated.
    const mediaSourceId = ctx.window.getMediaSourceId();
    const match = /^window:(\d+):/.exec(mediaSourceId);
    if (!match) throw new Error(`Unexpected mediaSourceId shape: ${mediaSourceId}`);
    const cgWindowId = match[1];
    try {
      await execFileAsync('/usr/sbin/screencapture', ['-x', '-t', 'png', '-l', cgWindowId, body.outPath]);
      const bytes = fs.statSync(body.outPath).size;
      return { ok: true, outPath: body.outPath, bytes, mode: 'native' };
    } catch (err) {
      throw new Error(
        `screencapture failed (cgWindowId=${cgWindowId}): ${err instanceof Error ? err.message : String(err)}\n` +
          `If this says "could not create image from window", grant Screen Recording permission to Electron / the terminal under System Settings → Privacy & Security → Screen Recording, then retry.`,
      );
    }
  }

  const image = await ctx.window.webContents.capturePage();
  const png = image.toPNG();
  fs.writeFileSync(body.outPath, png);
  return { ok: true, outPath: body.outPath, bytes: png.length, mode: 'content' };
}
