/**
 * Thin wrapper around the Phosphor icon system.
 * Renders an <i data-icon="..."> element that the global MutationObserver
 * in utils/icons.ts automatically converts to an SVG.
 */
export function Icon({ name, className }: { name: string; className?: string }) {
  return <i data-icon={name} className={className} />;
}
