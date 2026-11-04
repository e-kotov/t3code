import {
  resolveDeviceHubAccess,
  withDeviceHubQuery,
} from "@t3tools/client-runtime/state/deviceHubAccess";
import {
  BETTERWRIGHT_VIEWER_FALLBACK_PATH,
  type BetterWrightViewerFallbackBridge,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentSession } from "../state/session";

// Tickets are single-use, so every read mints a fresh one through the prepared connection.
const leaseAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: BETTERWRIGHT_VIEWER_FALLBACK_PATH });
    })
    .pipe(Atom.withLabel(`betterwright-viewer-fallback-access:${environmentId}`)),
);

/**
 * The authenticated lease socket address for one handoff tab, or null when this connection
 * cannot mint a ticket. Cookie-authenticated connections cannot hand their credential to the
 * desktop, so they get no fallback.
 */
export async function readViewerFallbackLeaseUrl(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly tabId: string;
}): Promise<string | null> {
  const atom = leaseAccessAtom(input.environmentId);
  appAtomRegistry.refresh(atom);
  const access = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, atom, { suspendOnWaiting: true }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
  if (access === null || access.credentials) return null;
  const query = new URLSearchParams({ threadId: input.threadId, tabId: input.tabId });
  return withDeviceHubQuery(`${access.wsBase}/ws?${query.toString()}`, access);
}

/** Present only in the desktop app, which owns the SSH identity and the saved SSH routes. */
export const viewerFallbackBridge = (): BetterWrightViewerFallbackBridge | undefined =>
  window.desktopBridge?.betterWrightViewerFallback;
