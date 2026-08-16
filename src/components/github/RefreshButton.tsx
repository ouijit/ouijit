import { useEffect, useRef, useState } from 'react';
import { Icon } from '../terminal/Icon';

/** Minimum spin, so a refresh that returns instantly still shows as one. */
const MIN_SPIN_MS = 450;

interface RefreshButtonProps {
  busy: boolean;
  onClick: () => void;
  /** Empty where something else is doing the telling — a tooltip around this. */
  title?: string;
}

/**
 * Refresh, with the spin held to a minimum duration.
 *
 * A warm `gh` call can return in well under a frame or two, and a spinner that
 * appears and vanishes that fast looks like a rendering fault — worse than no
 * feedback at all, because the user can't tell whether the click registered.
 * Holding the animation briefly past the response makes the press legible
 * without pretending the work took longer than it did.
 */
export function RefreshButton({ busy, onClick, title = 'Refresh' }: RefreshButtonProps) {
  const [spinning, setSpinning] = useState(busy);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (busy) {
      startedAt.current = Date.now();
      setSpinning(true);
      return;
    }
    if (!spinning) return;
    const elapsed = startedAt.current == null ? MIN_SPIN_MS : Date.now() - startedAt.current;
    const remaining = Math.max(0, MIN_SPIN_MS - elapsed);
    const timer = setTimeout(() => setSpinning(false), remaining);
    return () => clearTimeout(timer);
  }, [busy, spinning]);

  return (
    <button
      type="button"
      // Not disabled while spinning: the button is the user's recourse when
      // something looks stale, and refusing the second press is the wrong
      // answer to "did that do anything?".
      className="w-7 h-7 rounded-md text-text-secondary flex items-center justify-center transition-all duration-150 hover:bg-ink/10 hover:text-text-primary"
      title={title || undefined}
      // Named whether or not it carries a title of its own: wrapped in a
      // tooltip it has none, and a button holding one glyph has no other name.
      aria-label="Refresh"
      aria-busy={spinning}
      onClick={onClick}
    >
      <span
        className="flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4"
        style={spinning ? { animation: 'loading-dot-spin 0.8s linear infinite' } : undefined}
      >
        <Icon name="arrows-clockwise" />
      </span>
    </button>
  );
}
