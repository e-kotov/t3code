export const RECENT_CUSTOM_SNOOZES_KEY = "t3code.ek.recent-custom-snoozes";

/** Exact instants, newest selection first. Presets and durations never enter this history. */
export function recentCustomSnoozes(value: unknown, now: Date): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  const dates = value.flatMap((entry: unknown) => {
    if (typeof entry !== "string") return [];
    const ms = Date.parse(entry);
    return Number.isFinite(ms) && ms > now.getTime() ? [new Date(ms).toISOString()] : [];
  });
  return [...new Set(dates)].slice(0, 3);
}

export function createRecentCustomSnoozeStore(storage: {
  readonly getItem: (key: string) => string | null | Promise<string | null>;
  readonly setItem: (key: string, value: string) => unknown;
}) {
  let current: ReadonlyArray<string> = [];
  let loading: Promise<void> | undefined;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const load = () => {
    loading ??= Promise.resolve()
      .then(() => storage.getItem(RECENT_CUSTOM_SNOOZES_KEY))
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        current = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
        notify();
      })
      .catch(() => { /* Unavailable/corrupt storage must not block snoozing. */ });
    return loading;
  };
  return {
    load,
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      void load();
      return () => { listeners.delete(listener); };
    },
    async remember(snoozedUntil: string, now: Date) {
      await load();
      if (recentCustomSnoozes([snoozedUntil], now).length === 0) return;
      current = recentCustomSnoozes([snoozedUntil, ...current], now);
      const serialized = JSON.stringify(current);
      notify();
      // Keep hydration and writes ordered, including two selections made in quick succession.
      writes = writes.then(() => storage.setItem(RECENT_CUSTOM_SNOOZES_KEY, serialized)).then(() => {}).catch(() => {});
      await writes;
    },
  };
}
