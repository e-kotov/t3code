// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";

import { publishLockPath, publishWithoutReplace } from "./publishWithoutReplace.ts";
import { layerLinkDeniedFileSystem } from "./testUtils/linkDeniedFileSystem.ts";

// A second SQLite connection stands in for another process trying to publish into the directory.
const otherProcessCanLock = (lockPath: string) => {
  const otherProcess = new NodeSqlite.DatabaseSync(lockPath);
  try {
    otherProcess.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
    otherProcess.exec("ROLLBACK;");
    return true;
  } catch {
    return false;
  } finally {
    otherProcess.close();
  }
};

it.effect("holds the cross-process lock while it checks and renames", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-publish-lock-"));
  const fromPath = NodePath.join(directory, "mine.tmp");
  const toPath = NodePath.join(directory, "target");
  NodeFS.writeFileSync(fromPath, "mine");

  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const checking = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    // Pauses the publish at its existence check, inside the locked section.
    const pausingFileSystem: FileSystem.FileSystem = {
      ...fileSystem,
      exists: Effect.fn("PausingFileSystem.exists")(function* (path: string) {
        if (path === toPath) {
          yield* Deferred.succeed(checking, undefined);
          yield* Deferred.await(resume);
        }
        return yield* fileSystem.exists(path);
      }),
    };

    const publish = yield* Effect.forkChild(
      publishWithoutReplace(pausingFileSystem, fromPath, toPath),
    );
    yield* Deferred.await(checking);
    assert.isFalse(otherProcessCanLock(publishLockPath(toPath)));

    yield* Deferred.succeed(resume, undefined);
    yield* Fiber.join(publish);
    assert.isTrue(otherProcessCanLock(publishLockPath(toPath)));
    assert.strictEqual(NodeFS.readFileSync(toPath, "utf8"), "mine");
    assert.strictEqual(NodeFS.readFileSync(fromPath, "utf8"), "mine");
    assert.isFalse(NodeFS.readdirSync(directory).some((entry) => entry.endsWith(".publish")));
  }).pipe(
    Effect.provide(layerLinkDeniedFileSystem()),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
});
