import { useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';
import { ScopePicker, defaultScope } from './ScopePicker';

interface ConnectRowProps {
  projectPath: string;
  availability: LinearAvailability;
}

/**
 * What this project's Linear issues are, asked once and never in a modal —
 * someone who opened the panel to read a pull request is not made to configure
 * a tracker first. Pre-filled with whatever resolved; changed later from
 * project settings.
 */
export function ConnectRow({ projectPath, availability }: ConnectRowProps) {
  // The answer arrives with a later load, so the fallback is read on render
  // rather than captured as initial state.
  const [picked, setPicked] = useState<LinearScope | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = picked ?? defaultScope(availability);

  const connect = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await useLinearStore.getState().connect(projectPath, chosen);
    } finally {
      setBusy(false);
    }
  };

  if (!chosen) {
    return (
      <p className="px-4 py-3 text-[13px] text-text-tertiary text-balance">
        This key has no access to any teams. Check what it's limited to in Linear.
      </p>
    );
  }

  return (
    <div className="px-3 py-2.5 flex flex-col gap-1.5 border-b border-ink/[0.06]">
      <span className="px-1 text-[13px] text-text-tertiary">Show Linear issues from</span>
      <div className="flex items-center gap-2">
        <ScopePicker
          availability={availability}
          value={chosen}
          onChange={setPicked}
          disabled={busy}
          className="flex-1 min-w-0"
        />
        <button
          type="button"
          className="btn-primary btn-compact h-8 shrink-0"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
