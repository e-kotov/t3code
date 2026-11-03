// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as PlatformNodePath from "@effect/platform-node/NodePath";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerLinkDeniedFileSystem } from "../testUtils/linkDeniedFileSystem.ts";
import { initializeV2Database } from "./initializeV2Database.ts";

it.effect("publishes the V1 snapshot when hard links are denied", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v2-android-link-"));
  const sourcePath = NodePath.join(directory, "state.sqlite");
  const destinationPath = NodePath.join(directory, "statev2.sqlite");
  return Effect.gen(function* () {
    const source = new NodeSqlite.DatabaseSync(sourcePath);
    try {
      source.exec("CREATE TABLE messages(text TEXT); INSERT INTO messages VALUES ('from V1');");
    } finally {
      source.close();
    }

    yield* initializeV2Database(destinationPath);

    const copy = new NodeSqlite.DatabaseSync(destinationPath, { readOnly: true });
    try {
      assert.deepEqual(
        copy
          .prepare("SELECT text FROM messages")
          .all()
          .map((row) => row.text),
        ["from V1"],
      );
    } finally {
      copy.close();
    }
  }).pipe(
    Effect.provide(Layer.mergeAll(layerLinkDeniedFileSystem(), PlatformNodePath.layer)),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
});
