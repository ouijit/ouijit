import * as fs from 'node:fs';
import * as path from 'node:path';
import { imageMime } from './utils/imageMime';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function readMarkdownImage(markdownPath: string, src: string): Promise<string | null> {
  const imagePath = decodeSrc(src.replace(/[?#].*$/, ''));
  const mime = imageMime(imagePath);
  if (!mime) return null;

  const file = path.resolve(path.dirname(markdownPath), imagePath);
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
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
