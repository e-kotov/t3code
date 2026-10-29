import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import { makeAntigravityUsageProbe } from "./antigravityUsageLimits.ts";

const fixture = Effect.fn("ForkAntigravityQuotaTest.fixture")(function* (
  options: {
    partial?: boolean;
    empty?: boolean;
    unknownVersion?: boolean;
    failure?: "http" | "schema";
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profileDirectory = yield* fs.makeTempDirectoryScoped();
  yield* fs.makeDirectory(path.join(profileDirectory, "antigravity-acp"));
  yield* fs.writeFileString(
    path.join(profileDirectory, "antigravity-acp", "acp_token.json"),
    JSON.stringify({
      client_id: "test-client",
      client_secret: "test-secret",
      refresh_token: "test-refresh",
    }),
  );
  let version = "1.3.0";
  const requests: string[] = [];
  const userAgents: Array<string | undefined> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request.url);
      const json = (body: unknown, status = 200) =>
        HttpClientResponse.fromWeb(request, Response.json(body, { status }));
      if (request.url.endsWith("/token"))
        return json({ access_token: "test-access", expires_in: 3600 });
      if (request.url.endsWith("/userinfo")) return json({ id: "test-account" });
      if (request.url.endsWith(":fetchAvailableModels")) {
        return json({
          models: {
            "gemini-a": {
              modelProvider: "MODEL_PROVIDER_GOOGLE",
              quotaInfo: { remainingFraction: 1 },
            },
          },
        });
      }
      userAgents.push(request.headers["user-agent"]);
      if (options.failure === "http") return json({ error: "Unavailable" }, 503);
      if (options.failure === "schema") return json({ groups: "invalid" });
      const correctIdentity =
        request.headers["user-agent"] ===
        `antigravity/acp/${options.unknownVersion ? "1.4.1" : version} (aidev_client; os_type=darwin; arch=arm64)`;
      const buckets = options.empty
        ? []
        : [
            { bucketId: "3p-weekly", window: "weekly", remainingFraction: 1 },
            ...(!options.partial && correctIdentity
              ? [
                  { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.59 },
                  { bucketId: "gemini-5h", window: "5h", remainingFraction: 1 },
                ]
              : []),
          ];
      return json({
        groups: [
          { displayName: "Gemini Models", buckets },
          ...(!options.partial && !options.empty && correctIdentity
            ? [
                {
                  displayName: "Gemini 4 Argon",
                  buckets: [
                    {
                      bucketId: "gemini-argon-wtu-weekly",
                      window: "weekly",
                      remainingFraction: 0.01,
                    },
                  ],
                },
              ]
            : []),
        ],
      });
    }),
  );
  const input = {
    profileDirectory,
    authMethod: "oauth-personal" as const,
    runtimeVersion: Effect.sync(() => (options.unknownVersion ? null : version)),
    summaryOnly: true,
  };
  const usage = yield* makeAntigravityUsageProbe(input).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provideService(HostProcess.Architecture, "arm64"),
  );
  return {
    ...usage,
    requests,
    userAgents,
    updateVersion: () => {
      version = "1.4.1";
    },
  };
});

it.effect(
  "reads Gemini and Argon quotas with the installed ACP identity, including after a runtime update",
  () =>
    Effect.gen(function* () {
      const { probe, updateVersion } = yield* fixture();
      for (const update of [false, true]) {
        if (update) updateVersion();
        const limits = yield* probe;
        expect(limits.windows).toHaveLength(4);
        const byId = new Map(limits.windows.map((window) => [window.id, window]));
        expect(byId.get("gemini-weekly")?.usedPercent).toBeCloseTo(41);
        expect(byId.get("gemini-5h")?.usedPercent).toBe(0);
        expect(byId.get("gemini-argon-wtu-weekly")).toMatchObject({
          label: "Gemini 4 Argon · Weekly",
          kind: "weekly",
          usedPercent: 99,
        });
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not fill missing Gemini windows with per-model 100-percent readings", () =>
  Effect.gen(function* () {
    for (const empty of [false, true]) {
      const { probe, requests } = yield* fixture({ partial: true, empty });
      const limits = yield* probe;
      expect(limits.windows.map((window) => window.id)).toEqual(empty ? [] : ["3p-weekly"]);
      if (empty) {
        expect(limits.unavailable?.reason).toBe("unsupported");
        expect(limits.unavailable?.message).toContain("no subscription quota windows");
      }
      expect(requests.some((url) => url.endsWith(":fetchAvailableModels"))).toBe(false);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("uses the pinned ACP identity when a custom executable has no recorded version", () =>
  Effect.gen(function* () {
    const { probe, userAgents } = yield* fixture({ unknownVersion: true });
    const limits = yield* probe;
    expect(limits.unavailable).toBeUndefined();
    expect(limits.windows).toHaveLength(4);
    expect(userAgents).toEqual([
      "antigravity/acp/1.4.1 (aidev_client; os_type=darwin; arch=arm64)",
      "antigravity/acp/1.4.1 (aidev_client; os_type=darwin; arch=arm64)",
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports HTTP and malformed-summary failures as failed probes", () =>
  Effect.gen(function* () {
    for (const failure of ["http", "schema"] as const) {
      const { probe, requests } = yield* fixture({ failure });
      const limits = yield* probe;
      expect(limits.windows).toEqual([]);
      expect(limits.unavailable?.reason).toBe("probeFailed");
      expect(requests.some((url) => url.endsWith(":fetchAvailableModels"))).toBe(false);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
