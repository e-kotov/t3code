import { ProviderDriverKind, ThreadId, type OrchestrationV2CacheHud } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hotThreadIds, warmingState } from "./CacheWarmingToggle";

const updatedAt = "2026-10-13T08:00:00.000Z";
const now = Date.parse(updatedAt) + 10 * 60_000;

function hud(overrides: Partial<OrchestrationV2CacheHud> = {}): OrchestrationV2CacheHud {
  return {
    driver: ProviderDriverKind.make("codex"),
    basis: "estimated",
    ttlMs: 30 * 60_000,
    usage: { updatedAt, usedTokens: 20_000, inputTokens: 20_000, cachedInputTokens: 10_000 },
    ...overrides,
  };
}

function thread(
  id: string,
  cacheHud: OrchestrationV2CacheHud | null,
  archivedAt: string | null = null,
) {
  return { id: ThreadId.make(id), cacheHud, archivedAt };
}

describe("hotThreadIds", () => {
  it("keeps only unarchived Claude/Codex conversations with a warm cache", () => {
    const ids = hotThreadIds(
      [
        thread("warm", hud()),
        thread(
          "claude",
          hud({ driver: ProviderDriverKind.make("claudeAgent"), basis: "reported" }),
        ),
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
    expect(ids).toEqual(["warm", "claude"]);
  });
});

describe("warmingState", () => {
  const ids = [ThreadId.make("a"), ThreadId.make("b")];
  it("reports on, off or mixed across the given conversations", () => {
    expect(warmingState(ids, { a: true, b: true })).toBe("on");
    expect(warmingState(ids, { a: true })).toBe("mixed");
    expect(warmingState(ids, { c: true })).toBe("off");
    expect(warmingState([], {})).toBe("off");
  });
});
