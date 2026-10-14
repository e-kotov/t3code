// @effect-diagnostics globalDate:off globalTimers:off -- Synchronous React external-store timing, outside an Effect runtime.
import type { SlurmJobStatus } from "@t3tools/contracts";

interface ReceiptClock {
  readonly wall: number;
  readonly monotonic: number;
}

const receipts = new WeakMap<SlurmJobStatus, ReceiptClock>();
const clock = (): ReceiptClock => ({ wall: Date.now(), monotonic: performance.now() });

/** Stamp on wire receipt, not when a header first mounts; replay keeps the original anchor. */
export function receiveSlurmJobStatus<T extends SlurmJobStatus | null | undefined>(
  status: T,
  now = clock(),
): T {
  if (status && !receipts.has(status)) receipts.set(status, now);
  return status;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "due";
  if (seconds >= 86400) {
    const hours = Math.ceil(seconds / 3600);
    return `<${Math.floor(hours / 24)}d${hours % 24 ? `${hours % 24}h` : ""}`;
  }
  if (seconds >= 9 * 3600) return `<${Math.ceil(seconds / 360) / 10}h`;
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ""}`
    : `${minutes}m`;
}

export function slurmJobCountdownLabel(
  status: SlurmJobStatus | null | undefined,
  connected: boolean,
  now = clock(),
): string | null {
  if (!status) return null;
  receiveSlurmJobStatus(status, now);
  const received = receipts.get(status)!;
  // Monotonic time tolerates wall-clock corrections; the wall delta also
  // accounts for OS sleep on platforms where performance.now pauses.
  const elapsed = Math.max(0, now.monotonic - received.monotonic, now.wall - received.wall);
  const age = Math.max(0, status.serverNow - status.observedAt) + elapsed;
  if (!connected || age >= 300_000 || status.state === "unknown") return "time ?";
  if (status.state === "ended") return "ended";
  if (status.state === "suspended") return "paused";
  if (status.remainingSeconds === null) return "∞";
  return formatRemaining(status.remainingSeconds - age / 1000);
}

/** One minute timer per surface, shared by all mounted headers; none in the background. */
export function createSlurmCountdownClock(
  isActive: () => boolean,
  observeActivity: (refresh: () => void) => () => void,
) {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopObserving: (() => void) | undefined;
  function schedule() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (listeners.size > 0 && isActive()) timer = setTimeout(refresh, 60_000);
  }
  function refresh() {
    for (const listener of listeners) listener();
    schedule();
  }
  return (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) stopObserving = observeActivity(refresh);
    schedule();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopObserving?.();
        stopObserving = undefined;
      }
      schedule();
    };
  };
}
