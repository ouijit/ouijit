import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BlobContent } from '../../types';

export interface BinaryFileVersions {
  before: BlobContent | null;
  after: BlobContent | null;
}

interface BinaryFileViewProps {
  path: string;
  /** Loads both sides. Called on mount and whenever `revision` changes. */
  load: () => Promise<BinaryFileVersions>;
  /** Identifies the pair of revisions being compared, so a new one refetches. */
  revision?: string;
}

/**
 * What a binary file looks like when git has no lines to show for it.
 *
 * An image renders as its two versions side by side, which is the only reading
 * of an image change anyone can actually do. Everything else states the sizes,
 * because that is all that is knowable without an interpreter for the format.
 */
export function BinaryFileView({ path, load, revision }: BinaryFileViewProps) {
  const [versions, setVersions] = useState<BinaryFileVersions | null>(null);
  const [failed, setFailed] = useState(false);

  // Held in a ref so an inline closure for `load` doesn't refetch every render.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setFailed(false);
    loadRef.current().then(
      (result) => !cancelled && setVersions(result),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [path, revision]);

  if (failed) {
    return <Note>Could not read this file</Note>;
  }
  if (!versions) {
    return <Note>Loading…</Note>;
  }

  const { before, after } = versions;
  if (!before && !after) {
    return <Note>Binary file</Note>;
  }

  const mime = imageMime(path);
  if (!mime) {
    return (
      <Note>
        Binary file
        {before && ` · ${formatBytes(before.byteSize)} before`}
        {after && ` · ${formatBytes(after.byteSize)} after`}
      </Note>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-8 px-4 py-5">
      {before && <ImagePane label="Before" blob={before} mime={mime} tone="text-diff-removed" />}
      {after && <ImagePane label="After" blob={after} mime={mime} tone="text-diff-added" />}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center font-mono text-[11px] text-text-tertiary">{children}</div>;
}

/**
 * The checkerboard behind a transparent image. Without it a PNG with an alpha
 * channel is indistinguishable from one with a white or black background,
 * depending on the theme.
 */
const CHECKER: CSSProperties = {
  backgroundImage: [
    'linear-gradient(45deg, color-mix(in srgb, var(--color-ink) 7%, transparent) 25%, transparent 25%)',
    'linear-gradient(-45deg, color-mix(in srgb, var(--color-ink) 7%, transparent) 25%, transparent 25%)',
    'linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--color-ink) 7%, transparent) 75%)',
    'linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--color-ink) 7%, transparent) 75%)',
  ].join(', '),
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

function ImagePane({ label, blob, mime, tone }: { label: string; blob: BlobContent; mime: string; tone: string }) {
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className={`font-mono text-[11px] ${tone}`}>{label}</figcaption>
      <div
        className="flex items-center justify-center p-2 rounded-md border border-ink/[0.08] min-w-[120px] min-h-[80px]"
        style={CHECKER}
      >
        {blob.base64 && !broken ? (
          <img
            src={`data:${mime};base64,${blob.base64}`}
            alt={label}
            className="max-w-[380px] max-h-[380px] object-contain"
            onLoad={(e) => setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="font-mono text-[11px] text-text-tertiary px-3">
            {blob.base64 ? 'Could not decode' : 'Too large to preview'}
          </span>
        )}
      </div>
      <span className="font-mono text-[11px] text-text-tertiary">
        {dimensions ? `${dimensions} · ` : ''}
        {formatBytes(blob.byteSize)}
      </span>
    </figure>
  );
}

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

/** The MIME type a browser can render this path as, if any. */
export function imageMime(path: string): string | null {
  const cut = path.lastIndexOf('.');
  if (cut === -1) return null;
  return IMAGE_MIME[path.slice(cut + 1).toLowerCase()] ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
