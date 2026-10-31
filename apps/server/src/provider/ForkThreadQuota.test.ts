// @effect-diagnostics nodeBuiltinImport:off - Owns a temporary native Codex database fixture.
import * as NodeSqlite from "node:sqlite";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  ProviderThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Settings from "../serverSettings.ts";
import * as Registry from "./ProviderInstanceRegistry.ts";
import * as Quota from "./ForkThreadQuota.ts";
import { readCodexTaskInventory } from "./forkCodexTaskInventory.ts";

const instanceId = ProviderInstanceId.make("codex");
const threadId = ThreadId.make("app-thread");
const nativeId = ProviderThreadId.make("native-ref");
const driver = ProviderDriverKind.make("codex");

it.effect(
  "refreshes resumed task families, preserves missing/partial values and isolates accounts",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "codex-quota-" });
      const authPath = path.join(home, "auth.json");
      const credentials = (account: string) =>
        JSON.stringify({ tokens: { account_id: account, access_token: "private-token" } });
      yield* fs.writeFileString(authPath, credentials("account"));
      const db = new NodeSqlite.DatabaseSync(path.join(home, "state_5.sqlite"));
      yield* Effect.addFinalizer(() => Effect.sync(() => db.close()));
      db.exec(`CREATE TABLE threads(id TEXT,source TEXT,model_provider TEXT,created_at INTEGER,updated_at INTEGER,creator_account_id TEXT,attached_thread_parent_id TEXT);
      CREATE TABLE thread_spawn_edges(child_thread_id TEXT,parent_thread_id TEXT);
      INSERT INTO threads VALUES('root','appServer','openai',1,1,'account',NULL);
      INSERT INTO threads VALUES('child','appServer','openai',1,1,'account',NULL);
      INSERT INTO thread_spawn_edges VALUES('child','root');`);
      assert.deepEqual(
        readCodexTaskInventory(path.join(home, "state_5.sqlite"), "root", "account")
          ?.descendant_thread_ids,
        ["child"],
      );
      let calls = 0;
      let status = "available";
      let weekly: number | null = 150.25;
      let responseId = "root";
      let rotateAccount = false;
      const client = HttpClient.make((request) =>
        Effect.gen(function* () {
          calls++;
          assert.equal(
            request.url,
            "https://chatgpt.com/backend-api/wham/usage/thread_usage/query_v2",
          );
          assert.equal(request.headers["chatgpt-account-id"], "account");
          if (rotateAccount) yield* fs.writeFileString(authPath, credentials("other-account"));
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                data_as_of: "2026-10-31T12:00:00Z",
                threads: [
                  {
                    thread_id: responseId,
                    data_status: status,
                    weekly_limit_percent: weekly,
                    five_hour_limit_percent: null,
                    balance_usage_credits: "-0.000000000000000001",
                    groups: [],
                  },
                ],
              }),
            ),
          );
        }),
      );
      const projection = {
        getThreadRecords: () =>
          Effect.succeed({
            thread: { activeProviderThreadId: nativeId },
            providerThreads: [
              {
                id: nativeId,
                driver,
                providerInstanceId: instanceId,
                nativeThreadRef: { nativeId: "root" },
              },
            ],
          }),
      } as unknown as ProjectionStore.ProjectionStoreV2["Service"];
      const provider = {
        enabled: true,
        driverKind: driver,
        snapshot: { getSnapshot: Effect.succeed({ auth: { type: "chatgpt" } }) },
      } as unknown as ProviderInstance;
      const registry = {
        getInstance: () => Effect.succeed(provider),
      } as unknown as Registry.ProviderInstanceRegistry["Service"];
      const settings = {
        getSettings: Effect.succeed({
          providerInstances: {
            codex: {
              config: { homePath: "", setupMode: "existing" },
              environment: [{ name: "CODEX_HOME", value: home }],
            },
          },
        }),
      } as unknown as Settings.ServerSettingsService["Service"];
      const layer = Quota.layer.pipe(
        Layer.provide(Layer.succeed(ProjectionStore.ProjectionStoreV2, projection)),
        Layer.provide(Layer.succeed(Registry.ProviderInstanceRegistry, registry)),
        Layer.provide(Layer.succeed(Settings.ServerSettingsService, settings)),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      );
      yield* Effect.gen(function* () {
        const quota = yield* Quota.ForkThreadQuota;
        const concurrent = yield* Effect.all([quota.read(threadId), quota.read(threadId)], {
          concurrency: "unbounded",
        });
        assert.equal(concurrent[0].weeklyPercent, 150.25);
        assert.equal(concurrent[1].weeklyPercent, 150.25);
        assert.equal(calls, 1);
        db.exec("UPDATE threads SET updated_at=2 WHERE id='child'");
        weekly = 155;
        assert.equal((yield* quota.read(threadId)).weeklyPercent, 155);
        assert.equal(calls, 2);
        status = "partial";
        weekly = null;
        yield* TestClock.adjust("61 seconds");
        const partial = yield* quota.read(threadId);
        assert.equal(partial.status, "partial");
        assert.isNull(partial.weeklyPercent);
        assert.equal(partial.balanceCredits, "-0.000000000000000001");
        responseId = "other-thread";
        yield* TestClock.adjust("61 seconds");
        assert.equal((yield* quota.read(threadId)).status, "error");
        responseId = "root";
        status = "available";
        rotateAccount = true;
        yield* TestClock.adjust("61 seconds");
        assert.equal((yield* quota.read(threadId)).status, "error");
        const before = calls;
        assert.equal((yield* quota.read(threadId)).status, "unsupported");
        assert.equal(calls, before);
      }).pipe(Effect.provide(layer));
      db.exec(
        "INSERT INTO threads VALUES('other','appServer','openai',1,1,'other-account',NULL); INSERT INTO thread_spawn_edges VALUES('other','root');",
      );
      assert.isNull(readCodexTaskInventory(path.join(home, "state_5.sqlite"), "root", "account"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
