import {
  BearerConnectionCredential,
  ForkCredentialCatalog,
} from "@t3tools/client-runtime/connection";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";

import { type LockManagerLike, withLocks } from "./forkCatalogLock";
import { type CatalogBackend, makeCatalogStore } from "./storage";

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

const withToken = (token: string): ConnectionCatalogDocument => ({
  ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
  credentials: [
    { connectionId: "paired-1", credential: new BearerConnectionCredential({ token }) },
  ],
});

/**
 * Storage holding a corrupt catalog, whose first write behaves like the desktop
 * bridge's: it ignores cancellation and lands only when let go.
 */
const corruptWithNativeWrite = () => {
  let raw = "{not a catalog";
  let land: () => void = () => undefined;
  let started: () => void = () => undefined;
  const writeStarted = new Promise<void>((resolve) => {
    started = () => resolve();
  });
  let first = true;
  const backend: CatalogBackend = {
    read: Effect.sync(() => raw),
    write: (next) => {
      if (!first) {
        return Effect.sync(() => {
          raw = next;
        });
      }
      first = false;
      return Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            land = () => {
              raw = next;
              resolve();
            };
            started();
          }),
      );
    },
  };
  return {
    backend,
    tokens: () =>
      decode(raw).credentials.map(({ connectionId, credential }) => [
        connectionId,
        credential.token,
      ]),
    started: Effect.promise(() => writeStarted),
    land: Effect.sync(() => land()),
  };
};

const openTab = (backend: CatalogBackend) =>
  ForkCredentialCatalog.makeFreshCatalogStore(makeCatalogStore(backend));

describe("ForkCredentialCatalog on web storage", () => {
  it.effect(
    "a read stopped while it repairs a corrupt catalog holds it until the repair lands",
    () =>
      Effect.gen(function* () {
        const storage = corruptWithNativeWrite();
        const tab = yield* openTab(storage.backend);
        // The repair rewrites the catalog: the read is a write here.
        const reading = yield* tab.readFresh.pipe(Effect.forkChild);
        yield* storage.started;
        const stopping = yield* Fiber.interrupt(reading).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        const pairing = yield* tab
          .update(() => withToken("paired-again"))
          .pipe(Effect.forkChild({ startImmediately: true }));
        expect(pairing.pollUnsafe()).toBeUndefined();
        yield* storage.land;
        yield* Fiber.join(pairing);
        yield* Fiber.join(stopping);
        expect(storage.tokens()).toEqual([["paired-1", "paired-again"]]);
      }),
  );
});

/** An exclusive lock manager like the browser's, for one origin. */
const fakeLocks = (): LockManagerLike => {
  let held = false;
  const waiting: Array<() => void> = [];
  return {
    request: (_name, options, callback) =>
      new Promise((resolve, reject) => {
        const grant = () => {
          held = true;
          void Promise.resolve(callback()).finally(() => {
            held = false;
            waiting.shift()?.();
            resolve(undefined);
          });
        };
        if (!held) return grant();
        waiting.push(grant);
        options.signal.addEventListener("abort", () => {
          const index = waiting.indexOf(grant);
          if (index === -1) return;
          waiting.splice(index, 1);
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  };
};

describe("catalog Web Lock", () => {
  it.effect("holds one tab's rewrite until another's ends, and a gone waiter leaks nothing", () =>
    Effect.gen(function* () {
      const exclusive = withLocks(fakeLocks());
      const order: Array<string> = [];
      const gate = yield* Deferred.make<void>();
      const section = (name: string, wait: Effect.Effect<void>) =>
        exclusive(
          Effect.sync(() => order.push(`${name} start`)).pipe(
            Effect.andThen(wait),
            Effect.andThen(Effect.sync(() => order.push(`${name} end`))),
          ),
        );
      const first = yield* section("first", Deferred.await(gate)).pipe(Effect.forkChild);
      const second = yield* section("second", Effect.void).pipe(Effect.forkChild);
      const abandoned = yield* section("abandoned", Effect.void).pipe(Effect.forkChild);
      yield* Fiber.interrupt(abandoned);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      yield* section("third", Effect.void);
      expect(order).toEqual([
        "first start",
        "first end",
        "second start",
        "second end",
        "third start",
        "third end",
      ]);
    }),
  );
});
