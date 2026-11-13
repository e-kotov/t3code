import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type { ConnectionCatalogDocument } from "../platform/storageDocument.ts";
import { BearerConnectionCredential } from "./catalog.ts";
import type { ConnectionAttemptError } from "./model.ts";

/** The shape of each platform's catalog store, which caches the whole document. */
export interface CatalogStore<E> {
  readonly read: Effect.Effect<ConnectionCatalogDocument, E>;
  readonly update: (
    transform: (catalog: ConnectionCatalogDocument) => ConnectionCatalogDocument,
  ) => Effect.Effect<void, E>;
}

/** Holds other windows and tabs off the catalog, as a Web Lock does. */
export type CatalogExclusion = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

/**
 * Fork: a catalog store that never writes back a stale copy of another context's tokens.
 * Updates transform the stored document and credential reads take it fresh. `openStore`
 * builds the platform's own store with an empty cache, so its decoding and recovery still apply.
 */
export const makeFreshCatalogStore = Effect.fn("ForkCredentialCatalog.makeFreshCatalogStore")(
  function* <E, R>(
    openStore: Effect.Effect<CatalogStore<E>, never, R>,
    exclusion?: CatalogExclusion,
  ) {
    const context = yield* Effect.context<R>();
    const open = Effect.provideContext(openStore, context);
    const local = yield* Semaphore.make(1);
    const cache = yield* Ref.make(Option.none<ConnectionCatalogDocument>());
    const exclusive = <A>(effect: Effect.Effect<A, E>) =>
      local.withPermits(1)(exclusion === undefined ? effect : exclusion(effect));
    const remember = (document: ConnectionCatalogDocument) => Ref.set(cache, Option.some(document));

    const readFresh = exclusive(
      open.pipe(
        Effect.flatMap((store) => store.read),
        Effect.tap(remember),
      ),
    );
    const read = Ref.get(cache).pipe(
      Effect.flatMap(Option.match({ onNone: () => readFresh, onSome: Effect.succeed })),
    );
    const update: CatalogStore<E>["update"] = (transform) =>
      exclusive(
        open.pipe(
          Effect.flatMap((store) => store.update(transform).pipe(Effect.andThen(store.read))),
          Effect.flatMap(remember),
        ),
      );
    return { read, readFresh, update };
  },
);

/** Fork: compare-and-swap of one stored bearer token, for direct-session renewal. */
export class ForkCredentialSwap extends Context.Service<
  ForkCredentialSwap,
  {
    /** Replaces the token at `credentialId` only while it is still `expected`. */
    readonly swap: (
      credentialId: string,
      expected: string,
      next: string,
    ) => Effect.Effect<boolean, ConnectionAttemptError>;
  }
>()("@t3tools/client-runtime/connection/forkCredentialCatalog/ForkCredentialSwap") {}

export const makeCredentialSwap = <E extends ConnectionAttemptError>(catalog: CatalogStore<E>) =>
  ForkCredentialSwap.of({
    swap: (credentialId, expected, next) =>
      Effect.suspend(() => {
        let swapped = false;
        return catalog
          .update((document) => ({
            ...document,
            credentials: document.credentials.map((entry) => {
              if (
                entry.connectionId !== credentialId ||
                entry.credential._tag !== "BearerConnectionCredential" ||
                entry.credential.token !== expected
              ) {
                return entry;
              }
              swapped = true;
              return {
                connectionId: credentialId,
                credential: new BearerConnectionCredential({ token: next }),
              };
            }),
          }))
          .pipe(Effect.map(() => swapped));
      }),
  });
