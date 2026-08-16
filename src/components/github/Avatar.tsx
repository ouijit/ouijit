import { useState } from 'react';

interface AvatarProps {
  login: string;
  url?: string;
  /** Rendered size in CSS pixels. */
  size?: number;
  className?: string;
}

/**
 * A person, as a round image.
 *
 * The image is requested from GitHub's CDN at twice the rendered size so it
 * stays sharp on a retina panel, and with no referrer — the CDN has no business
 * knowing which page asked. A missing or broken URL falls back to the initial
 * on a colour derived from the login.
 */
export function Avatar({ login, url, size = 20, className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const src = url && !failed ? sized(url, size * 2) : null;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: src ? 'color-mix(in srgb, var(--color-ink) 8%, transparent)' : tint(login),
      }}
      title={login}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          aria-hidden
          className="font-sans font-medium leading-none text-ink/70"
          style={{ fontSize: Math.max(9, Math.round(size * 0.45)) }}
        >
          {(login[0] ?? '?').toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** GitHub avatar URLs take a size parameter; they already carry `?v=4`. */
function sized(url: string, px: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}s=${px}`;
}

/** Stable hue per login, at a saturation that survives both themes. */
function tint(login: string): string {
  let hash = 0;
  for (let i = 0; i < login.length; i++) hash = (hash * 31 + login.charCodeAt(i)) % 360;
  return `color-mix(in srgb, hsl(${hash} 55% 55%) 30%, transparent)`;
}
