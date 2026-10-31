import { CodexSettings, type ForkThreadQuota as Reading, type ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";
import { readCodexTaskInventory } from "./forkCodexTaskInventory.ts";

const Percent = Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)));
const Amounts = {
  five_hour_limit_percent: Schema.optionalKey(Percent),
  weekly_limit_percent: Schema.optionalKey(Percent),
  balance_usage_credits: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isPattern(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)))),
};
const Response = Schema.Struct({
  data_as_of: Schema.optionalKey(Schema.NullOr(Schema.String)),
  threads: Schema.Array(Schema.Struct({
    thread_id: Schema.String,
    data_status: Schema.Literals(["available", "partial", "unavailable"]),
    ...Amounts,
    groups: Schema.Array(Schema.Struct(Amounts)),
  })),
});
const Credentials = Schema.Struct({
  tokens: Schema.Struct({ access_token: Schema.NonEmptyString, account_id: Schema.NonEmptyString }),
});

export class ForkThreadQuota extends Context.Service<ForkThreadQuota, {
  readonly read: (threadId: ThreadId) => Effect.Effect<Reading>;
}>()("t3/provider/ForkThreadQuota") {}

const make = Effect.gen(function* () {
  const projection = yield* ProjectionStore.ProjectionStoreV2;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const cache = new Map<string, Reading>();
  const pending = new Map<string, Effect.Effect<Reading>>();
  const read = Effect.fn("ForkThreadQuota.read")(function* (threadId: ThreadId) {
    const now = yield* Clock.currentTimeMillis;
    const empty = (status: Reading["status"]): Reading => ({
      status, checkedAt: new Date(now).toISOString(), dataAsOf: null,
      fiveHourPercent: null, weeklyPercent: null, balanceCredits: null,
    });
    return yield* Effect.gen(function* () {
      const thread = yield* projection.getThread(threadId);
      const records = yield* projection.getThreadRecords(threadId, ["providerThreads"]);
      const native = records.providerThreads.find((row) => row.id === thread.activeProviderThreadId);
      if (native?.driver !== "codex" || !native.nativeThreadRef) return empty("unsupported");
      const instance = yield* providers.getInstance(native.providerInstanceId);
      if (!instance?.enabled || instance.driverKind !== "codex") return empty("unsupported");
      const snapshot = yield* instance.snapshot.getSnapshot;
      if (snapshot.auth.type !== "chatgpt") return empty("unsupported");
      const configured = (yield* settings.getSettings).providerInstances[native.providerInstanceId];
      const config = yield* Schema.decodeUnknownEffect(CodexSettings)(configured?.config);
      if (config.setupMode === "managed") return empty("unsupported");
      const layout = yield* resolveCodexHomeLayout(config);
      const home = layout.effectiveHomePath ?? layout.sharedHomePath;
      const authPath = path.join(home, "auth.json");
      const readCredentials = fs.readFileString(authPath).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Credentials))),
      );
      const credentials = yield* readCredentials;
      const task = yield* Effect.try(() => readCodexTaskInventory(
        path.join(home, "state_5.sqlite"), native.nativeThreadRef!.nativeId, credentials.tokens.account_id,
      ));
      if (!task) return empty("unsupported");
      const key = JSON.stringify([native.providerInstanceId, home, credentials.tokens.account_id,
        task.thread_id, task.descendant_thread_ids, task.updatedAt]);
      const cached = cache.get(key);
      if (cached && now - Date.parse(cached.checkedAt) < 60_000) return cached;
      const existing = pending.get(key);
      if (existing) return yield* existing;
      const request = Effect.gen(function* () {
        const response = yield* http.execute(HttpClientRequest.post(
          "https://chatgpt.com/backend-api/wham/usage/thread_usage/query_v2",
        ).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${credentials.tokens.access_token}`,
            "chatgpt-account-id": credentials.tokens.account_id,
          }),
          HttpClientRequest.bodyJsonUnsafe({ threads: [{
            thread_id: task.thread_id, created_at: task.created_at,
            descendant_thread_ids: task.descendant_thread_ids,
          }] }),
        ));
        if (response.status !== 200) return empty("unavailable");
        const payload = yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Response)));
        const after = yield* readCredentials;
        if (after.tokens.account_id !== credentials.tokens.account_id) return empty("unavailable");
        if (payload.threads.length !== 1 || payload.threads[0]?.thread_id !== task.thread_id) return empty("unavailable");
        const row = payload.threads[0];
        if (row.data_status === "unavailable") return empty("unavailable");
        return { status: row.data_status, checkedAt: new Date(now).toISOString(), dataAsOf: payload.data_as_of ?? null,
          fiveHourPercent: row.five_hour_limit_percent ?? null, weeklyPercent: row.weekly_limit_percent ?? null,
          balanceCredits: row.balance_usage_credits ?? null } satisfies Reading;
      }).pipe(
        Effect.timeout("10 seconds"),
        Effect.orElseSucceed(() => empty("unavailable")),
        Effect.tap((value) => Effect.sync(() => {
          if (cache.size >= 256) cache.clear();
          cache.set(key, value);
        })),
        Effect.ensuring(Effect.sync(() => pending.delete(key))),
      );
      const shared = yield* Effect.cached(request);
      pending.set(key, shared);
      return yield* shared;
    }).pipe(Effect.orElseSucceed(() => empty("unavailable")));
  });
  return ForkThreadQuota.of({ read });
});

export const layer = Layer.effect(ForkThreadQuota, make);
