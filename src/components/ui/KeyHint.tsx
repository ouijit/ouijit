/** One entry in a keyboard legend, sized to sit quietly under what it describes. */
export function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <kbd className="font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-ink/[0.06] text-text-tertiary">
        {keys}
      </kbd>
      <span className="truncate">{label}</span>
    </span>
  );
}
