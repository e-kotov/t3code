import type { ForkCredentialCatalog } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";

const CATALOG_LOCK_NAME = "t3code:connection-catalog";

/** The one `navigator.locks.request` form used here, so tests can supply their own. */
export interface LockManagerLike {
  readonly request: (
    name: string,
    options: { readonly signal: AbortSignal },
    callback: () => Promise<void> | undefined,
  ) => Promise<unknown>;
}

/** Waits for the lock; the returned function releases it. */
const acquire = (locks: LockManagerLike) =>
  Effect.callback<() => void>((resume) => {
    let release: (() => void) | undefined;
    let cancelled = false;
    const controller = new AbortController();
    locks
      .request(CATALOG_LOCK_NAME, { signal: controller.signal }, () => {
        // Granted after the waiter went away: hand the lock straight back.
        if (cancelled) return undefined;
        return new Promise<void>((resolve) => {
          release = resolve;
          resume(Effect.succeed(resolve));
        });
      })
      .catch(() => {
        // Without a lock this context still has its own; it only loses cross-tab exclusion.
        if (!cancelled) resume(Effect.succeed(() => undefined));
      });
    return Effect.sync(() => {
      cancelled = true;
      controller.abort();
      release?.();
    });
  });

/**
 * Holds other tabs and windows of this origin off the catalog while one
 * rewrites it. Waiting stays interruptible; a lock once held is always released.
 */
export const withLocks =
  (locks: LockManagerLike): ForkCredentialCatalog.CatalogExclusion =>
  (effect) =>
    Effect.uninterruptibleMask((restore) =>
      restore(acquire(locks)).pipe(
        Effect.flatMap((release) => restore(effect).pipe(Effect.ensuring(Effect.sync(release)))),
      ),
    );

/** Web Locks where the browser has them; otherwise only this context's own lock. */
export const catalogWebLock = (): ForkCredentialCatalog.CatalogExclusion | undefined =>
  typeof navigator !== "undefined" && "locks" in navigator ? withLocks(navigator.locks) : undefined;
