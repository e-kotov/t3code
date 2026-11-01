import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";

import * as SecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";

const environment = SecretStore.layer.pipe(
  Layer.provideMerge(ManagedPolicy.layerTest()),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-proxy-settings-" })),
  Layer.provide(NodeCrypto.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("reloads the environment proxy after the settings service restarts without clients", () =>
  Effect.gen(function* () {
    const proxy = { enabled: true, url: "socks5://127.0.0.1:1080" };
    yield* Effect.gen(function* () {
      const settings = yield* Settings.ServerSettingsService;
      yield* settings.updateSettings({ browserProxy: proxy });
    }).pipe(Effect.provide(Layer.fresh(Settings.layer)));
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    expect(JSON.parse(yield* fs.readFileString(config.settingsPath)).browserProxy).toEqual(proxy);
    const restored = yield* Effect.gen(function* () {
      const settings = yield* Settings.ServerSettingsService;
      return (yield* settings.getSettings).browserProxy;
    }).pipe(Effect.provide(Layer.fresh(Settings.layer)));
    expect(restored).toEqual(proxy);
  }).pipe(Effect.provide(environment)),
);
