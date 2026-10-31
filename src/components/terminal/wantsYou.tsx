import { useShallow } from 'zustand/react/shallow';
import { usePointerStore } from '../../stores/pointerStore';
import { isUnread, useTerminalStore, viewedPtyId, type TerminalStatus } from '../../stores/terminalStore';
import type { SandboxProviderId } from '../../types';
import { StatusDot } from './StatusDot';

/** Terminals whose agent is asking you to run something. */
export function useAsking(): string[] {
  return usePointerStore(useShallow((s) => s.pointers.filter((p) => p.ask).map((p) => p.from)));
}

/**
 * A terminal wants you when it finished while you were elsewhere, or when its
 * agent is asking to run something and you aren't looking at it. Both read as
 * unread: an ask blocks the agent until you answer.
 */
export function wantsYou(s: ReturnType<typeof useTerminalStore.getState>, ptyId: string, asking: string[]): boolean {
  const display = s.displayStates[ptyId];
  const viewed = viewedPtyId(s);
  return display !== undefined && (isUnread(display, viewed) || (asking.includes(ptyId) && ptyId !== viewed));
}

export function useWantsYou(ptyId: string): boolean {
  const asking = useAsking();
  return useTerminalStore((s) => wantsYou(s, ptyId, asking));
}

/** A terminal's dot wherever it is listed, blue while it wants you. */
export function TerminalDot({
  ptyId,
  status,
  sandboxProvider,
}: {
  ptyId: string;
  status: TerminalStatus;
  sandboxProvider?: SandboxProviderId;
}) {
  const unread = useWantsYou(ptyId);
  return <StatusDot status={status} sandboxProvider={sandboxProvider} unread={unread} />;
}
