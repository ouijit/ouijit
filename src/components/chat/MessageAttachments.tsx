import { useEffect, useState } from 'react';
import { Icon } from '../terminal/Icon';
import { FadeLine } from '../ui/FadeLine';
import { ImageViewer } from './ImageViewer';
import { formatBytes } from '../diff/BinaryFileView';
import type { ChatAttachment } from '../../chat/model';

/** Recent previews, so scrolling back past a message does not read its images again. */
const MAX_CACHED = 40;
const previews = new Map<string, Promise<string | null>>();

function previewOf(path: string): Promise<string | null> {
  let preview = previews.get(path);
  if (!preview) {
    preview = window.api.chat.attachmentPreview(path).catch(() => null);
    previews.set(path, preview);
    if (previews.size > MAX_CACHED) previews.delete(previews.keys().next().value!);
  }
  return preview;
}

const isImage = (attachment: ChatAttachment) => attachment.mimeType.startsWith('image/');

/**
 * What a sent message carried, above its text as a phone shows it: images as
 * themselves, at their own shape, and anything else as a card naming it.
 */
export function MessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  const images = attachments.filter(isImage);
  const files = attachments.filter((attachment) => !isImage(attachment));
  // Undefined while loading; null for an image that is gone, or too large to show.
  const [srcs, setSrcs] = useState<Record<string, string | null>>({});
  const [viewing, setViewing] = useState<number | null>(null);
  const paths = images.map((image) => image.path).join('\0');

  useEffect(() => {
    let live = true;
    for (const path of paths ? paths.split('\0') : []) {
      void previewOf(path).then((src) => live && setSrcs((shown) => ({ ...shown, [path]: src })));
    }
    return () => {
      live = false;
    };
  }, [paths]);

  const shown = images.filter((image) => typeof srcs[image.path] === 'string');
  const single = images.length === 1;
  return (
    <>
      {images.length > 0 && (
        <div className="flex flex-wrap items-end justify-end gap-1.5">
          {images.map((image, index) => {
            const src = srcs[image.path];
            if (src === null) return <FileCard key={`${image.path}-${index}`} attachment={image} />;
            if (src === undefined) {
              return (
                <span
                  key={`${image.path}-${index}`}
                  aria-hidden
                  className={`block rounded-[14px] bg-ink/[0.06] ${single ? 'w-[200px] h-[140px]' : 'w-[120px] h-[90px]'}`}
                />
              );
            }
            return (
              <button
                key={`${image.path}-${index}`}
                type="button"
                aria-label={`Open ${image.name}`}
                className="block p-0 border-none bg-transparent rounded-[14px] overflow-hidden cursor-zoom-in outline outline-1 -outline-offset-1 outline-ink/10"
                onClick={() => setViewing(shown.indexOf(image))}
              >
                <img
                  src={src}
                  alt={image.name}
                  className={`block w-auto h-auto ${single ? 'max-w-[280px] max-h-[280px]' : 'max-w-[180px] max-h-[140px]'}`}
                />
              </button>
            );
          })}
        </div>
      )}
      {files.map((attachment, index) => (
        <FileCard key={`${attachment.path}-${index}`} attachment={attachment} />
      ))}
      {viewing != null && (
        <ImageViewer
          srcs={shown.map((image) => srcs[image.path] as string)}
          start={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

function fileIcon(attachment: ChatAttachment): string {
  if (isImage(attachment)) return 'file-image';
  if (attachment.mimeType === 'application/pdf') return 'file-pdf';
  if (attachment.mimeType.startsWith('text/')) return 'file-text';
  return 'file';
}

function FileCard({ attachment }: { attachment: ChatAttachment }) {
  // Undefined while asking; null for a file that has gone since it was sent.
  const [size, setSize] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    window.api.chat.attachmentSize(attachment.path).then(
      (bytes) => live && setSize(bytes),
      () => live && setSize(null),
    );
    return () => {
      live = false;
    };
  }, [attachment.path]);
  return (
    <div className="flex items-center gap-2.5 max-w-[280px] rounded-[14px] bg-ink/[0.07] pl-2 pr-3 py-2">
      <span className="w-8 h-8 shrink-0 rounded-[9px] bg-ink/[0.08] flex items-center justify-center text-text-secondary">
        <Icon name={fileIcon(attachment)} className="w-[18px] h-[18px]" />
      </span>
      <span className="min-w-0 flex flex-col">
        <FadeLine className="text-[13px] text-text-primary">{attachment.name}</FadeLine>
        <span className="text-[11px] text-text-tertiary">
          {size != null ? formatBytes(size) : size === null ? 'No longer there' : ' '}
        </span>
      </span>
    </div>
  );
}
