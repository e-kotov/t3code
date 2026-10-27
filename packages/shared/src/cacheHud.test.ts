import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  type OrchestrationV2CacheHud,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  cacheWarmingState,
  deriveCacheHud,
  focusedCacheHud,
  describeCacheHud,
  describeUsageWindows,
  hotCacheThreadIds,
  presentCacheHud,
} from "./cacheHud.ts";

const updatedAt = "2026-10-13T08:00:00.000Z";
const start = Date.parse(updatedAt);

function localClock(ms: number) {
  // @effect-diagnostics-next-line globalDate:off -- Expected text uses the device local timezone, as the code does.
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function hud(overrides: Partial<OrchestrationV2CacheHud> = {}): OrchestrationV2CacheHud {
  return {
    driver: ProviderDriverKind.make("claudeAgent"),
    basis: "reported",
    ttlMs: 60 * 60_000,
    usage: {
      updatedAt,
      usedTokens: 140_000,
      maxTokens: 200_000,
      inputTokens: 123_000,
      cachedInputTokens: 123_000,
    },
    ...overrides,
  };
}

describe("deriveCacheHud", () => {
  it.each([
    [102_152, 101_760, 25_656, "26k/475k"],
    [231_901, 13_312, 25_411, "25k/475k"],
  ])(
    "updates a %i-token context after compaction without refreshing the cache",
    (usedTokens, cachedInputTokens, compactedTokens, contextText) => {
      const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
      const request = {
        updatedAt,
        usedTokens,
        maxTokens: 475_000,
        inputTokens: usedTokens - 5,
        cachedInputTokens,
        cacheScopeKey: "codex:gpt-6.1-sol",
      };
      const compacted = {
        ...request,
        updatedAt: "2026-10-13T08:30:00.000Z",
        usedTokens: compactedTokens,
        inputTokens: 0,
        cachedInputTokens: 0,
      };
      const before = deriveCacheHud(ProviderDriverKind.make("codex"), [request], selection)!;
      const after = deriveCacheHud(
        ProviderDriverKind.make("codex"),
        [compacted, request],
        selection,
      )!;
      expect(after.usage).toEqual({ ...request, usedTokens: compactedTokens });
      const now = start + 40 * 60_000;
      expect(presentCacheHud(after, now).contextText).toBe(contextText);
      expect(presentCacheHud(after, now).cacheText).toBe(presentCacheHud(before, now).cacheText);
      expect(presentCacheHud(after, now).remainingMs).toBe(20 * 60_000);
      expect(presentCacheHud(after, start + 60 * 60_000).state).toBe("unknown");
      const resumed = {
        ...request,
        updatedAt: "2026-10-13T08:40:00.000Z",
        usedTokens: compactedTokens + 5,
        inputTokens: compactedTokens,
        cachedInputTokens: 0,
      };
      expect(
        deriveCacheHud(ProviderDriverKind.make("codex"), [request, compacted, resumed], selection)
          ?.usage,
      ).toEqual(resumed);
    },
  );

  it("shows a context-only report without inventing a cache miss or lifetime", () => {
    const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
    const report = {
      updatedAt,
      usedTokens: 25_656,
      maxTokens: 475_000,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheScopeKey: "codex:gpt-6.1-sol",
    };
    const result = deriveCacheHud(ProviderDriverKind.make("codex"), [report], selection);
    expect(result).not.toBeNull();
    const view = presentCacheHud(result!, start);
    expect(view.contextText).toBe("26k/475k");
    expect(view.cacheText).toBe("? ⇣?");
    expect(view.state).toBe("unknown");
    expect(view.remainingMs).toBeNull();
  });

  it("keeps Codex's one-hour estimate despite earlier misses and becomes unknown at that boundary", () => {
    const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
    const reports = ["00", "05", "10", "15", "20", "25", "30"].map((minute, i) => ({
      updatedAt: `2026-10-13T08:${minute}:00.000Z`,
      usedTokens: 12_000,
      inputTokens: 12_000,
      cachedInputTokens: i % 2 === 0 ? 10_000 : 0,
      cacheScopeKey: "codex:gpt-6.1-sol",
    }));
    const result = deriveCacheHud(ProviderDriverKind.make("codex"), reports, selection)!;
    expect(result.ttlMs).toBe(60 * 60_000);
    expect(result.basis).toBe("estimated");
    const lastReport = Date.parse(reports.at(-1)!.updatedAt);
    expect(presentCacheHud(result, lastReport + 40 * 60_000).state).toBe("hot");
    expect(presentCacheHud(result, lastReport + 55 * 60_000).state).toBe("expiring");
    expect(presentCacheHud(result, lastReport + 60 * 60_000).state).toBe("unknown");
    expect(describeCacheHud(result, lastReport + 60 * 60_000).cache).toBe(
      "Cache status unknown · estimate elapsed",
    );
    expect(describeCacheHud(result, lastReport + 60 * 60_000).lastRequest).toBe(
      "Last request: 83% from cache (10k)",
    );
    expect(presentCacheHud(result, lastReport).description).toContain("assumed one-hour window");
  });
});

describe("describeCacheHud", () => {
  it("spells out a warm cache, the last request and context", () => {
    const details = describeCacheHud(hud(), start + 46 * 60_000);
    expect(details.state).toBe("hot");
    expect(details.cache).toBe(`Cache until ~${localClock(start + 3_600_000)} · 14 min left`);
    expect(details.lastRequest).toBe("Last request: 100% from cache (123k)");
    expect(details.context).toBe("Context 140k of 200k · 70%");
  });

  it("marks Codex lifetimes as estimates and shows cache writes", () => {
    const details = describeCacheHud(
      hud({
        driver: ProviderDriverKind.make("codex"),
        basis: "estimated",
        ttlMs: 60 * 60_000,
        usage: {
          updatedAt,
          usedTokens: 50_000,
          inputTokens: 40_000,
          cachedInputTokens: 10_000,
          cacheCreationTokens: 4_000,
        },
      }),
      start,
    );
    expect(details.cache).toBe(
      `Cache until ~${localClock(start + 3_600_000)} · 1 h left (estimate)`,
    );
    expect(details.lastRequest).toBe("Last request: 25% from cache (10k) · 4k written");
    expect(details.context).toBe("Context 50k");
  });

  it("distinguishes an expired cache, a missed request and an unknown lifetime", () => {
    expect(describeCacheHud(hud(), start + 2 * 3_600_000).cache).toBe(
      `Cache expired at ~${localClock(start + 3_600_000)}`,
    );
    const missed = describeCacheHud(
      hud({ usage: { ...hud().usage, cachedInputTokens: 0, cacheCreationTokens: 0 } }),
      start,
    );
    expect(missed.cache).toBe("Cache missed on the last request");
    const { ttlMs: _ttl, ...withoutTtl } = hud({ basis: "unknown" });
    expect(describeCacheHud(withoutTtl, start).cache).toBe("Cache lifetime unknown");
  });

  it("formats long remaining lifetimes in hours", () => {
    expect(describeCacheHud(hud(), start).cache).toContain("· 1 h left");
    expect(describeCacheHud(hud({ ttlMs: 90 * 60_000 }), start).cache).toContain(
      "· 1 h 30 min left",
    );
  });

  it("keeps a reported Codex miss cold after its estimate passes", () => {
    const missed = hud({
      driver: ProviderDriverKind.make("codex"),
      basis: "estimated",
      usage: { ...hud().usage, cachedInputTokens: 0 },
    });
    const details = describeCacheHud(missed, start + 2 * 3_600_000);
    expect(details.state).toBe("cold");
    expect(details.cache).toBe("Cache missed on the last request");
  });
});

describe("describeUsageWindows", () => {
  it("spells out session and weekly limits with their resets", () => {
    const rows = describeUsageWindows(
      [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 2.4,
          windowDurationMins: 300,
          resetsAt: "2026-10-13T10:21:00.000Z",
        },
        { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 35 },
        { id: "seven_day_fable", kind: "weekly", label: "Weekly · Fable", usedPercent: 7 },
        { id: "monthly", kind: "monthly", label: "Monthly", usedPercent: 50 },
      ],
      start,
    );
    expect(rows.map((row) => row.text)).toEqual([
      "5-hour limit: 98% left · resets in 2h 21m",
      "Weekly: 65% left",
      "Weekly · Fable: 93% left",
    ]);
  });

  it("returns nothing when the provider reports no limits", () => {
    expect(describeUsageWindows(undefined, start)).toEqual([]);
  });
});

describe("hotCacheThreadIds", () => {
  it("keeps only unarchived Claude/Codex conversations with a warm cache", () => {
    const now = start + 10 * 60_000;
    const thread = (
      id: string,
      cacheHud: OrchestrationV2CacheHud | null,
      archivedAt: string | null = null,
    ) => ({
      id: ThreadId.make(id),
      cacheHud,
      archivedAt,
    });
    const ids = hotCacheThreadIds(
      [
        thread("claude", hud()),
        thread("codex", hud({ driver: ProviderDriverKind.make("codex"), basis: "estimated" })),
        thread("expired", hud({ ttlMs: 5 * 60_000 })),
        thread("archived", hud(), "2026-10-13T08:05:00.000Z"),
        thread("other-provider", hud({ driver: ProviderDriverKind.make("cursor") })),
        thread(
          "nothing-cached",
          hud({ usage: { updatedAt, usedTokens: 1, cachedInputTokens: 0 } }),
        ),
        thread("no-hud", null),
      ],
      now,
    );
    expect(ids).toEqual(["claude", "codex"]);
  });
});

describe("cacheWarmingState", () => {
  const ids = [ThreadId.make("a"), ThreadId.make("b")];
  it("reports on, off or mixed across the given conversations", () => {
    expect(cacheWarmingState(ids, { a: true, b: true })).toBe("on");
    expect(cacheWarmingState(ids, { a: true })).toBe("mixed");
    expect(cacheWarmingState(ids, { c: true })).toBe("off");
    expect(cacheWarmingState(ids, undefined)).toBe("off");
    expect(cacheWarmingState([], {})).toBe("off");
  });
});

describe("focusedCacheHud", () => {
  const providerThreadId = ProviderThreadId.make("pi-child");
  const otherProviderThreadId = ProviderThreadId.make("old-provider");
  const selection = { instanceId: ProviderInstanceId.make("pi"), model: "saia/glm-5.3-flash" };
  const report = (usedTokens: number, timestamp: string) => ({
    usedTokens,
    maxTokens: 1_048_576,
    inputTokens: usedTokens - 298,
    cachedInputTokens: 0,
    outputTokens: 298,
    updatedAt: timestamp,
  });
  const stale = deriveCacheHud(
    ProviderDriverKind.make("pi"),
    [report(52_958, updatedAt)],
    selection,
  )!;
  const liveReport = report(210_460, "2026-10-13T11:15:52.165Z");
  const projection = {
    thread: { activeProviderThreadId: providerThreadId, modelSelection: selection },
    providerThreads: [{ id: providerThreadId, driver: ProviderDriverKind.make("pi") }],
    providerTurns: [{ providerThreadId, tokenUsage: liveReport }],
  };

  it("refreshes a focused subagent from 53k to 210k without a shell update", () => {
    expect(presentCacheHud(stale, start).contextText).toBe("53k/1m");
    const result = focusedCacheHud(stale, projection)!;
    expect(result.usage).toEqual(liveReport);
    expect(presentCacheHud(result, start).contextText).toBe("210k/1m");
    expect(stale.usage.usedTokens).toBe(52_958);
  });

  it("uses only the active provider thread, regardless of report order", () => {
    const result = focusedCacheHud(stale, {
      ...projection,
      providerThreads: [
        ...projection.providerThreads,
        { id: otherProviderThreadId, driver: ProviderDriverKind.make("codex") },
      ],
      providerTurns: [
        ...projection.providerTurns,
        {
          providerThreadId: otherProviderThreadId,
          tokenUsage: report(900_000, "2026-10-13T12:00:00Z"),
        },
      ],
    });
    expect(result?.usage).toEqual(liveReport);
  });

  it("keeps the shell fallback while detail loads, including an empty shell", () => {
    expect(focusedCacheHud(stale, null)).toBe(stale);
    expect(focusedCacheHud(undefined, undefined)).toBeNull();
  });

  it("clears stale usage when the active provider has no applicable reports", () => {
    expect(focusedCacheHud(stale, { ...projection, providerTurns: [] })).toBeNull();
    expect(focusedCacheHud(stale, { ...projection, providerThreads: [] })).toBeNull();
    expect(
      focusedCacheHud(stale, {
        ...projection,
        thread: {
          ...projection.thread,
          modelSelection: { ...selection, model: "different-model" },
        },
        providerTurns: [
          {
            providerThreadId,
            tokenUsage: { ...liveReport, cacheScopeKey: "pi:saia/glm-5.3-flash" },
          },
        ],
      }),
    ).toBeNull();
  });

  it("shows context-only usage when the active provider reports no turn usage", () => {
    const acpProjection = {
      thread: { activeProviderThreadId: providerThreadId, modelSelection: selection },
      providerThreads: [
        {
          id: providerThreadId,
          driver: ProviderDriverKind.make("antigravity"),
          contextUsage: { usedTokens: 125_000, maxTokens: 1_048_576 },
          updatedAt: DateTime.makeUnsafe("2026-10-13T11:20:00.000Z"),
        },
      ],
      providerTurns: [],
    };
    const result = focusedCacheHud(null, acpProjection)!;
    expect(result).toEqual({
      driver: ProviderDriverKind.make("antigravity"),
      usage: { usedTokens: 125_000, maxTokens: 1_048_576, updatedAt: "2026-10-13T11:20:00.000Z" },
      basis: "unknown",
    });
    expect(presentCacheHud(result, start).contextText).toBe("125k/1m");
  });

  it("does not carry a shell HUD's cache counts onto another provider", () => {
    const antigravityShell = hud({
      driver: ProviderDriverKind.make("antigravity"),
      basis: "unknown",
      usage: { updatedAt, usedTokens: 170_000, inputTokens: 170_000, cachedInputTokens: 167_000 },
    });
    const result = focusedCacheHud(antigravityShell, {
      thread: { activeProviderThreadId: providerThreadId, modelSelection: selection },
      providerThreads: [
        {
          id: providerThreadId,
          driver: ProviderDriverKind.make("codex"),
          contextUsage: { usedTokens: 50_000 },
          updatedAt: DateTime.makeUnsafe(updatedAt),
        },
      ],
      providerTurns: [],
    });
    expect(result?.usage).toEqual({ usedTokens: 50_000, updatedAt });
  });
});
