// @effect-diagnostics nodeBuiltinImport:off - Owns a temporary native Codex database fixture.
import * as NodeSqlite from "node:sqlite";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  ProviderThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
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

it.effect.each(["explicit", "missing config", "missing instance"] as const)(
  "%s settings: refreshes resumed families, preserves partial values and isolates accounts",
  (settingsMode) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const hostHome = yield* fs.makeTempDirectoryScoped({ prefix: "codex-quota-" });
      const home = path.join(hostHome, ".codex");
      yield* fs.makeDirectory(home);
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
      let activeNativeTask = "root";
      let switchNativeAfterProjectionRead = false;
      let delayed: { entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> } | null =
        null;
      const client = HttpClient.make((request) =>
        Effect.gen(function* () {
          calls++;
          assert.equal(
            request.url,
            "https://chatgpt.com/backend-api/wham/usage/thread_usage/query_v2",
          );
          assert.equal(request.headers["chatgpt-account-id"], "account");
          if (delayed) {
            yield* Deferred.succeed(delayed.entered, undefined);
            yield* Deferred.await(delayed.release);
          }
          if (rotateAccount)
            yield* fs.writeFileString(authPath, credentials("other-account")).pipe(Effect.orDie);
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
          Effect.sync(() => {
            const selected = activeNativeTask;
            if (switchNativeAfterProjectionRead) activeNativeTask = "other";
            return {
              thread: { activeProviderThreadId: nativeId },
              providerThreads: [
                {
                  id: nativeId,
                  driver,
                  providerInstanceId: instanceId,
                  nativeThreadRef: { nativeId: selected },
                },
              ],
            };
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
      const allowed = {
        driver: "codex" as const,
        usageAccess: "allowed" as const,
        ...(settingsMode === "explicit" ? { config: { homePath: "", setupMode: "existing" } } : {}),
        environment: [{ name: "CODEX_HOME", value: home }],
      };
      let configured:
        | { driver?: string; enabled?: boolean; usageAccess?: "allowed" | "denied" }
        | undefined = settingsMode === "missing instance" ? undefined : allowed;
      const getSettings = Effect.sync(() => ({
        providerInstances: configured === undefined ? {} : { codex: configured },
      }));
      const settings = {
        getSettings,
        withSettingsSnapshot: (
          use: (snapshot: Effect.Success<typeof getSettings>) => Effect.Effect<unknown>,
        ) => Effect.flatMap(getSettings, use),
      } as unknown as Settings.ServerSettingsService["Service"];
      const layer = Quota.layer.pipe(
        Layer.provide(Layer.succeed(ProjectionStore.ProjectionStoreV2, projection)),
        Layer.provide(Layer.succeed(Registry.ProviderInstanceRegistry, registry)),
        Layer.provide(Layer.succeed(Settings.ServerSettingsService, settings)),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      );
      yield* Effect.gen(function* () {
        const quota = yield* Quota.ForkThreadQuota;
        if (configured === undefined) {
          // No consent must return unsupported even when reading auth.json would fail.
          yield* fs.remove(authPath);
          for (const decision of [
            undefined,
            { driver: "codex" },
            { driver: "codex", usageAccess: "denied" as const },
            { ...allowed, enabled: false },
            { ...allowed, driver: "cursor" },
          ]) {
            configured = decision;
            const reading = yield* quota.read(threadId);
            assert.equal(reading.status, "unsupported");
            assert.isNull(reading.weeklyPercent);
            assert.equal(calls, 0);
          }
          return;
        }
        const concurrent = yield* Effect.all([quota.read(threadId), quota.read(threadId)], {
          concurrency: "unbounded",
        });
        assert.equal(concurrent[0].weeklyPercent, 150.25);
        assert.equal(concurrent[1].weeklyPercent, 150.25);
        assert.equal(calls, 1);
        switchNativeAfterProjectionRead = true;
        const staleCached = yield* quota.read(threadId);
        assert.equal(staleCached.status, "error");
        assert.isNull(staleCached.weeklyPercent);
        assert.equal(calls, 1);
        switchNativeAfterProjectionRead = false;
        activeNativeTask = "root";
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
        weekly = 158;
        yield* TestClock.adjust("61 seconds");
        delayed = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
        const inFlight = yield* quota.read(threadId).pipe(Effect.forkChild);
        yield* Deferred.await(delayed.entered);
        db.exec(
          "INSERT INTO threads VALUES('replacement','appServer','openai',1,1,'account',NULL)",
        );
        activeNativeTask = "replacement";
        yield* Deferred.succeed(delayed.release, undefined);
        const stale = yield* Fiber.join(inFlight);
        assert.equal(stale.status, "error");
        assert.isNull(stale.weeklyPercent);
        delayed = null;
        responseId = "replacement";
        weekly = 3.75;
        assert.equal((yield* quota.read(threadId)).weeklyPercent, 3.75);
        configured = { ...allowed, usageAccess: "denied" };
        assert.equal((yield* quota.read(threadId)).status, "unsupported");
        configured = { ...allowed };
        delayed = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
        const revokedRead = yield* quota.read(threadId).pipe(Effect.forkChild);
        yield* Deferred.await(delayed.entered);
        configured = { ...allowed, usageAccess: "denied" };
        // A fast re-grant is a fresh settings generation, not an authorization for old results.
        configured = { ...allowed };
        yield* Deferred.succeed(delayed.release, undefined);
        const revoked = yield* Fiber.join(revokedRead);
        assert.equal(revoked.status, "unsupported");
        assert.isNull(revoked.weeklyPercent);
        delayed = null;
        assert.equal((yield* quota.read(threadId)).weeklyPercent, 3.75);
        rotateAccount = true;
        yield* TestClock.adjust("61 seconds");
        assert.equal((yield* quota.read(threadId)).status, "error");
        const before = calls;
        assert.equal((yield* quota.read(threadId)).status, "unsupported");
        assert.equal(calls, before);
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(HostProcess.HomeDirectory, hostHome),
        Effect.provideService(HostProcess.Environment, {}),
      );
      db.exec(
        "INSERT INTO threads VALUES('other','appServer','openai',1,1,'other-account',NULL); INSERT INTO thread_spawn_edges VALUES('other','root');",
      );
      assert.isNull(readCodexTaskInventory(path.join(home, "state_5.sqlite"), "root", "account"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
