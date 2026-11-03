import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Semaphore from "effect/Semaphore";

// Serializes the check-then-rename fallback so concurrent creators cannot replace a winner.
const renameFallbackLock = Semaphore.makeUnsafe(1);

// Android denies hard links to apps such as Termux; an atomic rename still hides partial files.
export const publishSecretFile = Effect.fn("ServerSecretStore.publishSecretFile")(function* (
  fileSystem: FileSystem.FileSystem,
  tempPath: string,
  secretPath: string,
) {
  yield* fileSystem.link(tempPath, secretPath).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "PermissionDenied",
      (linkError) =>
        renameFallbackLock.withPermits(1)(
          Effect.gen(function* () {
            if (yield* fileSystem.exists(secretPath)) {
              return yield* PlatformError.systemError({
                _tag: "AlreadyExists",
                module: "FileSystem",
                method: "link",
                pathOrDescriptor: secretPath,
                cause: linkError,
              });
            }
            yield* fileSystem.rename(tempPath, secretPath);
          }),
        ),
    ),
  );
});
