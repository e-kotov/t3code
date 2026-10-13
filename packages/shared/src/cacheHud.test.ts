import { ProviderDriverKind, type OrchestrationV2CacheHud } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { describeCacheHud, describeUsageWindows } from "./cacheHud.ts";

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
        ttlMs: 30 * 60_000,
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
      `Cache until ~${localClock(start + 1_800_000)} · 30 min left (estimate)`,
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
