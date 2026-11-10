import * as fs from 'node:fs';
import * as path from 'node:path';
import { imageMime } from './utils/imageMime';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * A local image a markdown file points at, as a data URL. `src` is the path as
 * written in the markdown, relative to the file or absolute. Null when it is
 * not an image by extension, is missing, or is past `maxBytes`.
 */
export async function readMarkdownImage(
  markdownPath: string,
  src: string,
  maxBytes: number = MAX_IMAGE_BYTES,
): Promise<string | null> {
  const relative = decodeSrc(src.replace(/[?#].*$/, ''));
  const mime = imageMime(relative);
  if (!mime) return null;

  const file = path.resolve(path.dirname(markdownPath), relative);
  try {
    const { size } = await fs.promises.stat(file);
    if (size > maxBytes) return null;
    const data = await fs.promises.readFile(file);
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

function decodeSrc(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}
