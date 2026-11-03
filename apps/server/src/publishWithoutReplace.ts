import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Semaphore from "effect/Semaphore";

// Serializes this process's publishers, so only one of them waits on the cross-process lock.
const renameFallbackLock = Semaphore.makeUnsafe(1);

const LOCK_RETRY_INTERVAL = "20 millis";
const LOCK_ATTEMPTS = 500;

const isSqliteBusy = (cause: unknown) =>
  cause instanceof Error &&
  (("errcode" in cause && cause.errcode === 5) ||
    ("code" in cause && cause.code === "SQLITE_BUSY"));

const lockError = (
  _tag: "Busy" | "TimedOut" | "Unknown",
  lockPath: string,
  description: string,
  cause?: unknown,
) =>
  PlatformError.systemError({
    _tag,
    module: "FileSystem",
    method: "link",
    pathOrDescriptor: lockPath,
    description,
    cause,
  });

/** The lock file shared by all processes publishing into the directory of `toPath`. */
export const publishLockPath = (toPath: string) =>
  `${toPath.slice(0, Math.max(toPath.lastIndexOf("/"), toPath.lastIndexOf("\\")) + 1)}.publish-lock.sqlite`;

// An exclusive SQLite transaction is held by the open connection, so the system releases it
// when the process exits or crashes; no stale-lock timeout is needed.
const holdPublishLock = Effect.fn("publishWithoutReplace.holdPublishLock")(function* (
  lockPath: string,
) {
  const db = yield* Effect.acquireRelease(
    Effect.try({
      try: () => new NodeSqlite.DatabaseSync(lockPath),
      catch: (cause) => lockError("Unknown", lockPath, "Could not open the publish lock.", cause),
    }),
    (db) => Effect.sync(() => db.close()),
  );
  const tryLock = Effect.try({
    try: () => {
      db.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
      return true;
    },
    catch: (cause) =>
      isSqliteBusy(cause)
        ? lockError("Busy", lockPath, "Another process holds the publish lock.", cause)
        : lockError("Unknown", lockPath, "Could not take the publish lock.", cause),
  }).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "Busy",
      () => Effect.succeed(false),
    ),
  );
  for (let attempt = 1; !(yield* tryLock); attempt++) {
    if (attempt >= LOCK_ATTEMPTS) {
      return yield* lockError("TimedOut", lockPath, "Timed out waiting for the publish lock.");
    }
    yield* Effect.sleep(LOCK_RETRY_INTERVAL);
  }
});

// Publishes a completed file without replacing an existing one and keeps the source, like link().
// Android denies hard links to apps such as Termux, so it falls back to an atomic rename of a copy,
// checked and renamed under a lock shared by every process publishing into the same directory.
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
          // Keep the source permissions, such as 0600 for secrets, on the published copy.
          Effect.andThen(fileSystem.stat(fromPath)),
          Effect.flatMap((info) => fileSystem.chmod(stagingPath, info.mode & 0o777)),
          // Flush the copy to disk first, so a published file is never partial after power loss.
          Effect.andThen(
            Effect.scoped(
              Effect.flatMap(fileSystem.open(stagingPath, { flag: "r+" }), (file) => file.sync),
            ),
          ),
          Effect.andThen(
            renameFallbackLock.withPermits(1)(
              Effect.scoped(
                Effect.gen(function* () {
                  yield* holdPublishLock(publishLockPath(toPath));
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
          ),
          Effect.ensuring(fileSystem.remove(stagingPath).pipe(Effect.ignore)),
        );
      },
    ),
  );
});
