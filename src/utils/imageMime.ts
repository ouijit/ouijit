const IMAGE_MIME: Record<string, string> = {
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

export function imageMime(path: string): string | null {
  const cut = path.lastIndexOf('.');
  if (cut === -1) return null;
  const extension = path.slice(cut + 1).toLowerCase();
  return Object.hasOwn(IMAGE_MIME, extension) ? IMAGE_MIME[extension] : null;
}
