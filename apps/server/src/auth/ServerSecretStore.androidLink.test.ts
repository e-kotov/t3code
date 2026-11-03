import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

// Android refuses link() for apps such as Termux with EACCES, which Effect reports as PermissionDenied.
// Each refusal waits until `creators` callers have arrived, so they all reach the fallback together.
const layerLinkDeniedFileSystem = (creators: number) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const arrived = yield* Ref.make(0);
      const allArrived = yield* Deferred.make<void>();

      return {
        ...fileSystem,
        link: (fromPath, toPath) =>
          Effect.gen(function* () {
            if ((yield* Ref.updateAndGet(arrived, (count) => count + 1)) >= creators) {
              yield* Deferred.succeed(allArrived, undefined);
            }
            yield* Deferred.await(allArrived);
            return yield* Effect.fail(
              PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "FileSystem",
                method: "link",
                pathOrDescriptor: `${fromPath} -> ${toPath}`,
                description: "Permission denied while creating a hard link.",
              }),
            );
          }),
      } satisfies FileSystem.FileSystem;
    }),
  ).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const layerLinkDeniedSecretStore = (creators = 1) =>
  ServerSecretStore.layer.pipe(
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-secret-store-android-link-test-" }),
    ),
    Layer.provideMerge(layerLinkDeniedFileSystem(creators)),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "ServerSecretStore without hard links",
  (it) => {
    it.effect("stores a created secret and leaves no temporary file", () =>
      Effect.gen(function* () {
        const secretStore = yield* ServerSecretStore.ServerSecretStore;
        const fileSystem = yield* FileSystem.FileSystem;

        yield* secretStore.create("secret-request", Uint8Array.from([1, 2, 3]));

        const stored = yield* secretStore.get("secret-request");
        assert.deepEqual(Array.from(Option.getOrThrow(stored)), [1, 2, 3]);
        const entries = yield* fileSystem.readDirectory(secretStore.directory ?? "");
        assert.deepEqual(
          entries.filter((entry) => entry.startsWith("secret-request")),
          ["secret-request.bin"],
        );
      }).pipe(Effect.provide(layerLinkDeniedSecretStore())),
    );

    it.effect("still refuses to replace an existing secret", () =>
      Effect.gen(function* () {
        const secretStore = yield* ServerSecretStore.ServerSecretStore;

        yield* secretStore.create("secret-request", Uint8Array.from([1]));
        const error = yield* Effect.flip(
          secretStore.create("secret-request", Uint8Array.from([2])),
        );

        assert.isTrue(ServerSecretStore.isSecretAlreadyExistsError(error));
        const stored = yield* secretStore.get("secret-request");
        assert.deepEqual(Array.from(Option.getOrThrow(stored)), [1]);
      }).pipe(Effect.provide(layerLinkDeniedSecretStore())),
    );

    it.effect("gives concurrent creators the persisted secret", () =>
      Effect.gen(function* () {
        const secretStore = yield* ServerSecretStore.ServerSecretStore;

        const results = yield* Effect.all(
          [
            secretStore.getOrCreateRandom("session-signing-key", 32),
            secretStore.getOrCreateRandom("session-signing-key", 32),
          ],
          { concurrency: "unbounded" },
        );
        const persisted = Array.from(
          Option.getOrThrow(yield* secretStore.get("session-signing-key")),
        );

        for (const result of results) assert.deepEqual(Array.from(result), persisted);
      }).pipe(Effect.provide(layerLinkDeniedSecretStore(2))),
    );
  },
);
