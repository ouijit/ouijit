/**
 * Task prompt attachments — images/media pasted into a task's prompt input.
 *
 * Pasted images are written to a stable directory under userData. The saved
 * file's absolute path is inserted into the task prompt text so CLI agents
 * (Claude Code, Codex, …) can read the image when the task runs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getUserDataPath } from './paths';
import { generateId } from './utils/ids';
import log from './log';

const attachmentsLog = log.scope('attachments');

/** Image extensions accepted from a paste. Keyed by normalized lowercase ext. */
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

/** Reject anything larger than 25 MB — a pasted screenshot is far smaller. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface SaveAttachmentResult {
  success: boolean;
  /** Absolute path to the written file, present on success. */
  path?: string;
  error?: string;
}

/** Directory holding all task prompt attachments. */
export function getAttachmentsDir(): string {
  return path.join(getUserDataPath(), 'attachments');
}

/**
 * Persist a pasted image to disk and return its absolute path.
 *
 * @param data Raw image bytes from the clipboard.
 * @param ext  File extension (with or without leading dot).
 */
/** Markdown image markers `![](path)` — pulls out the absolute path tokens. */
const ATTACHMENT_PATH_REGEX = /!\[\]\(([^)]+)\)/g;

/** Extract the set of unique attachment paths referenced by a description. */
export function extractAttachmentPaths(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ATTACHMENT_PATH_REGEX)) seen.add(match[1]);
  return [...seen];
}

/**
 * Best-effort delete of attachment files no longer referenced. Paths outside
 * the managed attachments directory are skipped — this only sweeps files we
 * placed ourselves. Failures are logged but never thrown; an orphan that
 * survives a crash will be re-cleaned the next time the description changes.
 */
export async function deleteOrphanedAttachments(orphans: readonly string[]): Promise<void> {
  if (orphans.length === 0) return;
  const dir = getAttachmentsDir();
  const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  for (const filePath of orphans) {
    if (!path.resolve(filePath).startsWith(dirWithSep)) continue;
    try {
      await fs.promises.unlink(filePath);
      attachmentsLog.info('deleted orphan attachment', { filePath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      const message = error instanceof Error ? error.message : String(error);
      attachmentsLog.warn('failed to delete orphan attachment', { filePath, error: message });
    }
  }
}

export async function saveAttachment(data: Uint8Array, ext: string): Promise<SaveAttachmentResult> {
  try {
    const normalizedExt = ext.replace(/^\./, '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(normalizedExt)) {
      return { success: false, error: `Unsupported attachment type: ${ext}` };
    }
    if (data.byteLength === 0) {
      return { success: false, error: 'Attachment is empty' };
    }
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      return { success: false, error: 'Attachment exceeds the 25 MB limit' };
    }

    const dir = getAttachmentsDir();
    await fs.promises.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${generateId('img')}.${normalizedExt}`);
    await fs.promises.writeFile(filePath, Buffer.from(data));

    attachmentsLog.info('saved attachment', { filePath, bytes: data.byteLength });
    return { success: true, path: filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attachmentsLog.error('failed to save attachment', { error: message });
    return { success: false, error: message };
  }
}
