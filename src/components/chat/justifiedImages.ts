/** The height a row aims for. A short last row stops at it rather than growing. */
const ROW_HEIGHT = 230;
/** Shorter than this, a row gives its last image to the next one. */
const MIN_ROW_SHARE = 0.65;
const GAP = 6;
/** What an image is laid out as until it has loaded and says its own shape. */
const PLACEHOLDER_ASPECT = 3 / 2;

export interface Box {
  width: number;
  height: number;
}

/**
 * Images, by aspect ratio (width over height), laid out in rows that share a
 * height within each row and fill `width` edge to edge, as a photo library
 * shows them. A row ends once it is no taller than `target`, keeping the image
 * that got it there unless that leaves it too short to read.
 */
export function justifiedRows(aspects: number[], width: number, target = ROW_HEIGHT, gap = GAP): Box[] {
  const boxes: Box[] = [];
  const heightOf = (row: number[]) => (width - gap * (row.length - 1)) / row.reduce((sum, i) => sum + aspects[i], 0);
  const place = (row: number[], height: number, fill: boolean) => {
    const widths = row.map((i) => Math.floor(aspects[i] * height));
    // What rounding down left over goes to the last, so a full row meets the edge exactly.
    if (fill) widths[widths.length - 1] += width - gap * (row.length - 1) - widths.reduce((a, b) => a + b, 0);
    for (const w of widths) boxes.push({ width: w, height: Math.round(height) });
  };

  let row: number[] = [];
  for (let i = 0; i < aspects.length; i++) {
    row.push(i);
    let height = heightOf(row);
    if (height > target) continue;
    const without = row.slice(0, -1);
    if (without.length > 0 && height < target * MIN_ROW_SHARE) {
      place(without, heightOf(without), true);
      row = [i];
      height = heightOf(row);
      if (height > target) continue;
    }
    place(row, height, true);
    row = [];
  }
  if (row.length > 0) place(row, Math.min(target, heightOf(row)), false);
  return boxes;
}

function aspectOf(img: HTMLImageElement): number {
  return img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : PLACEHOLDER_ASPECT;
}

/**
 * Lays out every set of two or more images in a rendered reply, again as each
 * image loads and as the column changes width. Its alt text is its tooltip.
 */
export function justifyImageSets(root: HTMLElement | null): (() => void) | void {
  if (!root) return;
  const sets = [...root.querySelectorAll<HTMLElement>('.chat-images')]
    .map((set) => ({ set, images: [...set.querySelectorAll<HTMLImageElement>(':scope > img')] }))
    .filter(({ images }) => images.length > 1);
  if (sets.length === 0) return;

  const layout = (set: HTMLElement, images: HTMLImageElement[]) => {
    const width = set.clientWidth;
    if (width <= 0) return;
    justifiedRows(images.map(aspectOf), width).forEach((box, i) => {
      images[i].style.width = `${box.width}px`;
      images[i].style.height = `${box.height}px`;
    });
  };
  const cleanups: (() => void)[] = [];
  for (const { set, images } of sets) {
    const again = () => layout(set, images);
    for (const img of images) {
      if (img.alt && !img.title) img.title = img.alt;
      img.addEventListener('load', again);
      cleanups.push(() => img.removeEventListener('load', again));
    }
    again();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(again);
      observer.observe(set);
      cleanups.push(() => observer.disconnect());
    }
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
