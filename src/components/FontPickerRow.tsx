import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
import { Icon } from './terminal/Icon';
import log from 'electron-log/renderer';

const fontPickerLog = log.scope('fontPicker');

export interface MonoFontOption {
  label: string;
  /** CSS font-family value — quoted family name with `monospace` fallback. */
  value: string;
}

/**
 * Curated fallback list — used when `queryLocalFonts()` is unavailable
 * (older Chromium) or the user denies the local-fonts permission.
 */
export const FALLBACK_FONT_OPTIONS: MonoFontOption[] = [
  { label: 'Iosevka Term Extended', value: 'Iosevka Term Extended, SF Mono, Monaco, Menlo, monospace' },
  { label: 'SF Mono', value: 'SF Mono, Menlo, monospace' },
  { label: 'Menlo', value: 'Menlo, Monaco, monospace' },
  { label: 'Monaco', value: 'Monaco, Menlo, monospace' },
];

/** Wider Window typing for the experimental Local Font Access API. */
interface FontDataLike {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

interface WindowWithLocalFonts {
  queryLocalFonts?: () => Promise<FontDataLike[]>;
}

function quoteFamily(family: string): string {
  return `"${family.replace(/"/g, '\\"')}"`;
}

function toOption(family: string): MonoFontOption {
  return { label: family, value: `${quoteFamily(family)}, monospace` };
}

/**
 * Width-based monospace heuristic. In monospace fonts, every glyph is the
 * same advance width — so 'i' and 'M' will measure equal. Cross-checks the
 * font is actually rendering (not silently falling back) by measuring
 * against two distinct generic fallbacks.
 */
function isMonospace(family: string, ctx: CanvasRenderingContext2D): boolean {
  const quoted = quoteFamily(family);

  // Verify the font is actually loaded — if it falls back, two different
  // fallback stacks would produce different widths for the same character.
  ctx.font = `12px ${quoted}, serif`;
  const probeSerif = ctx.measureText('i').width;
  ctx.font = `12px ${quoted}, sans-serif`;
  const probeSans = ctx.measureText('i').width;
  if (Math.abs(probeSerif - probeSans) > 0.1) return false;

  // Now compare a narrow glyph and a wide glyph — equal in monospace.
  ctx.font = `12px ${quoted}, monospace`;
  const wI = ctx.measureText('i').width;
  const wM = ctx.measureText('M').width;
  return Math.abs(wI - wM) < 0.5;
}

let cachedSystemFonts: MonoFontOption[] | null = null;

async function loadSystemMonospaceFonts(): Promise<MonoFontOption[] | null> {
  if (cachedSystemFonts) return cachedSystemFonts;
  const win = window as Window & WindowWithLocalFonts;
  if (typeof win.queryLocalFonts !== 'function') return null;

  let fonts: FontDataLike[];
  try {
    fonts = await win.queryLocalFonts();
  } catch (err) {
    fontPickerLog.warn('queryLocalFonts denied or failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const families = new Set<string>();
  for (const f of fonts) families.add(f.family);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const mono: MonoFontOption[] = [];
  for (const family of families) {
    if (isMonospace(family, ctx)) mono.push(toOption(family));
  }
  mono.sort((a, b) => a.label.localeCompare(b.label));
  cachedSystemFonts = mono;
  return mono;
}

interface FontPickerRowProps {
  label: string;
  description: string;
  value: string;
  defaultLabel: string;
  onCommit: (value: string) => void;
}

export function FontPickerRow({ label, description, value, defaultLabel, onCommit }: FontPickerRowProps) {
  const [open, setOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<MonoFontOption[] | null>(cachedSystemFonts);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (triggerRef.current) refs.setReference(triggerRef.current);
  }, [refs]);

  // On first dropdown open, ask Chromium for the user's installed fonts.
  // The first call shows a permission prompt; subsequent calls are silent.
  useEffect(() => {
    if (!open) return;
    if (systemFonts) return;
    setLoading(true);
    loadSystemMonospaceFonts()
      .then((list) => setSystemFonts(list))
      .finally(() => setLoading(false));
  }, [open, systemFonts]);

  // Click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [open]);

  // Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const options = systemFonts && systemFonts.length > 0 ? systemFonts : FALLBACK_FONT_OPTIONS;
  const usingFallback = !systemFonts || systemFonts.length === 0;

  const trimmedValue = value.trim();
  const selectedOption = useMemo(() => options.find((o) => o.value === trimmedValue) ?? null, [options, trimmedValue]);
  const triggerLabel = selectedOption?.label ?? (trimmedValue ? 'Custom' : defaultLabel);
  const triggerFont = selectedOption?.value ?? (trimmedValue || undefined);

  const select = (next: string) => {
    setOpen(false);
    onCommit(next);
  };

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-0.5">{description}</div>
      </div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-[16rem] shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 text-sm bg-white/[0.04] border border-white/10 rounded-md text-text-primary hover:bg-white/[0.06] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-light"
      >
        <span className="truncate" style={triggerFont ? { fontFamily: triggerFont } : undefined}>
          {triggerLabel}
        </span>
        <Icon name="caret-down" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
      </button>
      {open &&
        createPortal(
          <div
            ref={(el) => {
              dropdownRef.current = el;
              refs.setFloating(el);
            }}
            role="listbox"
            aria-label="Choose terminal font"
            style={floatingStyles}
            className="w-[16rem] max-h-[24rem] overflow-y-auto bg-surface border border-border rounded-md shadow-lg z-[1000] py-1"
          >
            <FontOptionRow
              label={defaultLabel}
              hint="System default"
              selected={!trimmedValue}
              onClick={() => select('')}
            />
            <div className="my-1 mx-3 border-t border-white/[0.06]" />
            {loading && <div className="px-3 py-2 text-xs text-text-tertiary">Loading installed fonts…</div>}
            {!loading && options.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-tertiary">No monospace fonts found.</div>
            )}
            {!loading &&
              options.map((opt) => (
                <FontOptionRow
                  key={opt.value}
                  label={opt.label}
                  fontFamily={opt.value}
                  selected={trimmedValue === opt.value}
                  onClick={() => select(opt.value)}
                />
              ))}
            {!loading && usingFallback && (
              <div className="px-3 pt-2 pb-1 text-[11px] text-text-tertiary border-t border-white/[0.06] mt-1">
                Showing fallback list — allow font access to see your installed fonts.
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

interface FontOptionRowProps {
  label: string;
  hint?: string;
  fontFamily?: string;
  selected: boolean;
  onClick: () => void;
}

function FontOptionRow({ label, hint, fontFamily, selected, onClick }: FontOptionRowProps) {
  return (
    <button
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-background-tertiary transition-colors duration-100 ${
        selected ? 'text-text-primary bg-white/[0.04]' : 'text-text-secondary'
      }`}
    >
      <span className="flex-1 truncate" style={fontFamily ? { fontFamily } : undefined}>
        {label}
      </span>
      {hint && <span className="text-[11px] text-text-tertiary shrink-0">{hint}</span>}
      {selected && <Icon name="check" className="w-3.5 h-3.5 text-text-primary shrink-0" />}
    </button>
  );
}
