// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { publishLockPath, publishWithoutReplace } from "./publishWithoutReplace.ts";
import { layerLinkDeniedFileSystem } from "./testUtils/linkDeniedFileSystem.ts";

it.live("waits for another process's publish and then refuses to replace its file", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-publish-lock-"));
  const fromPath = NodePath.join(directory, "mine.tmp");
  const toPath = NodePath.join(directory, "target");
  NodeFS.writeFileSync(fromPath, "mine");
  // A second SQLite connection stands in for another server process inside its publish.
  const otherProcess = new NodeSqlite.DatabaseSync(publishLockPath(toPath));
  otherProcess.exec("BEGIN EXCLUSIVE;");
  let otherProcessOpen = true;
  const finishOtherPublish = Effect.sync(() => {
    NodeFS.writeFileSync(toPath, "theirs");
    otherProcess.close();
    otherProcessOpen = false;
  });

  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    const [error] = yield* Effect.all(
      [
        Effect.flip(publishWithoutReplace(fileSystem, fromPath, toPath)),
        Effect.sleep("200 millis").pipe(Effect.andThen(finishOtherPublish)),
      ],
      { concurrency: "unbounded" },
    );

    assert.strictEqual(error.reason._tag, "AlreadyExists");
    assert.strictEqual(NodeFS.readFileSync(toPath, "utf8"), "theirs");
    assert.strictEqual(NodeFS.readFileSync(fromPath, "utf8"), "mine");
    assert.isFalse(NodeFS.readdirSync(directory).some((entry) => entry.endsWith(".publish")));
  }).pipe(
    Effect.provide(layerLinkDeniedFileSystem()),
    Effect.ensuring(
      Effect.sync(() => {
        if (otherProcessOpen) otherProcess.close();
        NodeFS.rmSync(directory, { recursive: true, force: true });
      }),
    ),
  );
});
