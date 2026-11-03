import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { layerLinkDeniedFileSystem } from "../testUtils/linkDeniedFileSystem.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";

const layerLinkDeniedServerEnvironment = (baseDir: string) =>
  ServerEnvironment.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provide(layerLinkDeniedFileSystem()),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "ServerEnvironment without hard links",
  (it) => {
    it.effect("persists a new environment id across service restarts", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-server-environment-android-link-test-",
        });
        const environmentId = Effect.gen(function* () {
          const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
          return (yield* serverEnvironment.getDescriptor).environmentId;
        }).pipe(Effect.provide(layerLinkDeniedServerEnvironment(baseDir)));

        const first = yield* environmentId;
        const second = yield* environmentId;

        expect(second).toBe(first);
      }),
    );
  },
);
