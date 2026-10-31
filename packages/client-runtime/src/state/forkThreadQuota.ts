import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import * as RemoteAuthorization from "../authorization/service.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { createEnvironmentSessionAtoms } from "./session.ts";
import { minuteTick } from "../clock.ts";

export function createForkThreadQuotaAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const session = createEnvironmentSessionAtoms(runtime);
  return Atom.family((key: string) => {
    const [environmentId, threadId] = JSON.parse(key) as [EnvironmentId, ThreadId];
    return runtime
      .atom((get) => {
        get.addFinalizer(minuteTick.subscribe(() => get.refreshSelf()));
        const prepared = Option.getOrNull(get(session.preparedConnectionValueAtom(environmentId)));
        if (!prepared) return Effect.never;
        return Effect.gen(function* () {
          const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
          const remoteAuthorization = yield* Effect.serviceOption(
            RemoteAuthorization.RemoteEnvironmentAuthorization,
          );
          const client = yield* Effect.serviceOption(HttpClient.HttpClient);
          if (Option.isNone(client)) return yield* Effect.never;
          return yield* executeAuthenticatedEnvironmentHttpRequest({
            prepared,
            signer,
            remoteAuthorization,
            group: "threadQuota",
            method: "GET",
            url: (urls) => urls.read({ params: { threadId } }),
            timeoutMs: 15_000,
            request: ({ client, headers }) => client.read({ params: { threadId }, headers }),
          }).pipe(Effect.provideService(HttpClient.HttpClient, client.value));
        });
      })
      .pipe(Atom.swr({ staleTime: 60_000, revalidateOnMount: true }), Atom.setIdleTTL(0));
  });
}
