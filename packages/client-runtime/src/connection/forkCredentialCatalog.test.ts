import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  type ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "../platform/storageDocument.ts";
import { BearerConnectionCredential } from "./catalog.ts";
import * as ForkCredentialCatalog from "./forkCredentialCatalog.ts";

const withToken = (token: string): ConnectionCatalogDocument => ({
  ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
  credentials: [
    { connectionId: "paired-1", credential: new BearerConnectionCredential({ token }) },
  ],
});

/**
 * One stored catalog shared by every tab, window or app context. Each opened
 * store caches the whole document from its first read, as the platforms' do.
 */
const sharedCatalog = (initial: ConnectionCatalogDocument) => {
  let stored = initial;
  const openStore = Effect.sync((): ForkCredentialCatalog.CatalogStore<never> => {
    let cached: ConnectionCatalogDocument | undefined;
    return {
      read: Effect.sync(() => (cached ??= stored)),
      update: (transform) =>
        Effect.sync(() => {
          cached = transform(cached ?? stored);
          stored = cached;
        }),
    };
  });
  const open = ForkCredentialCatalog.makeFreshCatalogStore(openStore);
  const tokens = () => stored.credentials.map((entry) => entry.credential.token);
  return { open, tokens, stored: () => stored };
};

const tokenIn = (document: ConnectionCatalogDocument) => document.credentials[0]?.credential.token;
const disable = (document: ConnectionCatalogDocument): ConnectionCatalogDocument => ({
  ...document,
  disabledEnvironmentIds: [EnvironmentId.make("environment-other")],
});

describe("ForkCredentialCatalog", () => {
  it.effect("a context with an old copy never writes back a token another replaced", () =>
    Effect.gen(function* () {
      const catalog = sharedCatalog(withToken("first"));
      const renewing = yield* catalog.open;
      const stale = yield* catalog.open;
      yield* renewing.read;
      yield* stale.read;

      const swap = ForkCredentialCatalog.makeCredentialSwap(renewing);
      expect(yield* swap.swap("paired-1", "first", "renewed")).toBe(true);
      yield* stale.update(disable);
      expect(catalog.tokens()).toEqual(["renewed"]);
      expect(catalog.stored().disabledEnvironmentIds).toEqual(["environment-other"]);
      // Its next connect reads the renewed token, without reloading.
      expect(tokenIn(yield* stale.readFresh)).toBe("renewed");

      // A credential one context removed stays removed.
      yield* renewing.update((document) => ({ ...document, credentials: [] }));
      yield* stale.update(disable);
      expect(catalog.tokens()).toEqual([]);
    }),
  );

  it.effect("a renewal never replaces a token paired again since it was read", () =>
    Effect.gen(function* () {
      const catalog = sharedCatalog(withToken("first"));
      const renewing = yield* catalog.open;
      const pairing = yield* catalog.open;
      yield* renewing.read;
      yield* pairing.update(() => withToken("paired-again"));
      const swap = ForkCredentialCatalog.makeCredentialSwap(renewing);
      expect(yield* swap.swap("paired-1", "first", "renewed")).toBe(false);
      expect(catalog.tokens()).toEqual(["paired-again"]);
    }),
  );
});
