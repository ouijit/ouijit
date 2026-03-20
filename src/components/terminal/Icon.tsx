/**
 * Renders a Phosphor icon as a React-owned <svg> element.
 * Extracts inner content from the raw SVG string so React owns the
 * outer <svg> node — no MutationObserver replacement that breaks reconciliation.
 */
import { iconMap } from '../../utils/icons';

const SVG_INNER_RE = /<svg[^>]*>([\s\S]*)<\/svg>/;
const VIEWBOX_RE = /viewBox="([^"]*)"/;

export function Icon({ name, className }: { name: string; className?: string }) {
  const raw = iconMap[name];
  if (!raw) return null;

  const inner = SVG_INNER_RE.exec(raw)?.[1] ?? '';
  const viewBox = VIEWBOX_RE.exec(raw)?.[1] ?? '0 0 256 256';

  return (
    <svg
      width="24"
      height="24"
      viewBox={viewBox}
      fill="currentColor"
      className={className}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
