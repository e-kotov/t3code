import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";

// Android refuses link() for apps such as Termux with EACCES, which Effect reports as PermissionDenied.
// Each refusal waits until `callers` links have arrived, so racing publishers reach the fallback together.
export const layerLinkDeniedFileSystem = (callers = 1) =>
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
            if ((yield* Ref.updateAndGet(arrived, (count) => count + 1)) >= callers) {
              yield* Deferred.succeed(allArrived, undefined);
            }
            yield* Deferred.await(allArrived);
            return yield* PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "link",
              pathOrDescriptor: `${fromPath} -> ${toPath}`,
              description: "Permission denied while creating a hard link.",
            });
          }),
      } satisfies FileSystem.FileSystem;
    }),
  ).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));
