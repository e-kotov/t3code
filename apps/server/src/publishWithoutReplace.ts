import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Semaphore from "effect/Semaphore";

// Serializes the check-then-rename fallback so concurrent publishers cannot replace a winner.
const renameFallbackLock = Semaphore.makeUnsafe(1);

// Publishes a completed file without replacing an existing one and keeps the source, like link().
// Android denies hard links to apps such as Termux, so it falls back to an atomic rename of a copy.
export const publishWithoutReplace = Effect.fn("publishWithoutReplace")(function* (
  fileSystem: FileSystem.FileSystem,
  fromPath: string,
  toPath: string,
) {
  yield* fileSystem.link(fromPath, toPath).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "PermissionDenied",
      (linkError) => {
        const stagingPath = `${fromPath}.publish`;
        return fileSystem.copyFile(fromPath, stagingPath).pipe(
          // Flush the copy to disk first, so a published file is never empty after power loss.
          Effect.andThen(
            Effect.scoped(
              Effect.flatMap(fileSystem.open(stagingPath, { flag: "r+" }), (file) => file.sync),
            ),
          ),
          Effect.andThen(
            renameFallbackLock.withPermits(1)(
              Effect.gen(function* () {
                if (yield* fileSystem.exists(toPath)) {
                  return yield* PlatformError.systemError({
                    _tag: "AlreadyExists",
                    module: "FileSystem",
                    method: "link",
                    pathOrDescriptor: toPath,
                    cause: linkError,
                  });
                }
                yield* fileSystem.rename(stagingPath, toPath);
              }),
            ),
          ),
          Effect.ensuring(fileSystem.remove(stagingPath).pipe(Effect.ignore)),
        );
      },
    ),
  );
});
