import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import {
  BearerConnectionCredential,
  ForkCredentialCatalog,
} from "@t3tools/client-runtime/connection";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";

import { CONNECTION_CATALOG_KEY, make } from "./catalog-store";
import * as MobileSecureStorage from "../persistence/mobile-secure-storage";

const encodeCatalog = Schema.encodeSync(Schema.fromJsonString(ConnectionCatalogDocument));
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

/**
 * Secure storage whose first write behaves like `SecureStore.setItemAsync`: it
 * ignores cancellation and lands only when let go. Every later call is immediate.
 */
const nativeFirstWrite = (values: Map<string, string>) => {
  let land: () => void = () => undefined;
  let started: () => void = () => undefined;
  const writeStarted = new Promise<void>((resolve) => {
    started = () => resolve();
  });
  let first = true;
  const storage = MobileSecureStorage.MobileSecureStorage.of({
    getItem: (key) => Effect.sync(() => values.get(key) ?? null),
    setItem: (key, value) => {
      if (!first) {
        return Effect.sync(() => {
          values.set(key, value);
        });
      }
      first = false;
      return Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve) => {
            land = () => {
              values.set(key, value);
              resolve();
            };
            started();
          }),
        catch: (cause) =>
          new MobileSecureStorage.MobileSecureStorageError({ operation: "write", key, cause }),
      });
    },
    removeItem: (key) =>
      Effect.sync(() => {
        values.delete(key);
      }),
  });
  return {
    storage,
    started: Effect.promise(() => writeStarted),
    land: Effect.sync(() => land()),
  };
};

describe("ForkCredentialCatalog on mobile secure storage", () => {
  it.effect("a renewal stopped mid-write holds the catalog until its write lands", () =>
    Effect.gen(function* () {
      const values = new Map([
        [
          CONNECTION_CATALOG_KEY,
          encodeCatalog({
            ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
            credentials: [
              {
                connectionId: "paired-1",
                credential: new BearerConnectionCredential({ token: "first" }),
              },
            ],
          }),
        ],
      ]);
      const native = nativeFirstWrite(values);
      const store = yield* ForkCredentialCatalog.makeFreshCatalogStore(make()).pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, native.storage),
      );
      const renewal = yield* ForkCredentialCatalog.makeCredentialSwap(store)
        .swap("paired-1", "first", "renewed")
        .pipe(Effect.forkChild);
      yield* native.started;
      const stopping = yield* Fiber.interrupt(renewal).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      // Removing the pairing now must wait: the renewal's write is still under way.
      const removal = yield* store
        .update((document) => ({ ...document, credentials: [] }))
        .pipe(Effect.forkChild({ startImmediately: true }));
      expect(removal.pollUnsafe()).toBeUndefined();
      yield* native.land;
      yield* Fiber.join(removal);
      yield* Fiber.join(stopping);
      expect(decodeCatalog(values.get(CONNECTION_CATALOG_KEY)).credentials).toEqual([]);
    }),
  );
});
