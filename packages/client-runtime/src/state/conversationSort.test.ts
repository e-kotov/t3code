import { describe, expect, it } from "vite-plus/test";

import { sortSidebarConversations } from "./conversationSort.ts";
import { sortSidebarConversations as sortFromThreadSortSubpath } from "./threadSortEntry.ts";

const NOW = Date.parse("2026-06-02T12:00:00.000Z");

function thread(
  id: string,
  overrides: Partial<{
    environmentId: string;
    createdAt: string;
    updatedAt: string;
    latestUserMessageAt: string | null;
    cacheHud: Parameters<typeof sortSidebarConversations>[0][number]["cacheHud"];
  }> = {},
) {
  return {
    id,
    environmentId: "env-a",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    latestUserMessageAt: null,
    ...overrides,
  };
}

function cacheHud(updatedAt: string, ttlMs: number | undefined, cachedInputTokens = 100) {
  return {
    driver: "claudeAgent",
    basis: "reported",
    ttlMs,
    usage: { usedTokens: 1, cachedInputTokens, updatedAt },
  } as never;
}

const ids = (threads: ReadonlyArray<{ readonly id: string }>) => threads.map(({ id }) => id);

describe("sortSidebarConversations", () => {
  it("stays reachable through the thread-sort subpath", () => {
    expect(sortFromThreadSortSubpath).toBe(sortSidebarConversations);
  });

  it("orders recent activity by the latest user message, then updatedAt, then id", () => {
    const threads = [
      thread("b", { updatedAt: "2026-06-02T09:00:00.000Z" }),
      thread("a", { latestUserMessageAt: "2026-06-02T10:00:00.000Z" }),
      thread("c", { updatedAt: "2026-06-02T09:00:00.000Z" }),
    ];
    expect(ids(sortSidebarConversations(threads, "updated_at", NOW))).toEqual(["a", "b", "c"]);
  });

  it("orders created_at newest first and breaks ties by id then environment", () => {
    const threads = [
      thread("x", { createdAt: "2026-06-01T00:00:00.000Z", environmentId: "env-b" }),
      thread("y", { createdAt: "2026-06-02T00:00:00.000Z" }),
      thread("x", { createdAt: "2026-06-01T00:00:00.000Z", environmentId: "env-a" }),
    ];
    const sorted = sortSidebarConversations(threads, "created_at", NOW);
    expect(sorted.map((row) => `${row.id}@${row.environmentId}`)).toEqual([
      "y@env-a",
      "x@env-a",
      "x@env-b",
    ]);
  });

  it("puts hot caches first by expiry; cold, expired or unknown caches follow by activity", () => {
    const threads = [
      thread("cold-recent", { latestUserMessageAt: "2026-06-02T11:59:00.000Z" }),
      thread("late-expiry", { cacheHud: cacheHud("2026-06-02T11:58:00.000Z", 10 * 60_000) }),
      thread("expired", {
        latestUserMessageAt: "2026-06-02T11:00:00.000Z",
        cacheHud: cacheHud("2026-06-02T11:00:00.000Z", 5 * 60_000),
      }),
      thread("soon-expiry", { cacheHud: cacheHud("2026-06-02T11:58:00.000Z", 5 * 60_000) }),
      thread("no-ttl", {
        latestUserMessageAt: "2026-06-02T10:00:00.000Z",
        cacheHud: cacheHud("2026-06-02T11:59:00.000Z", undefined),
      }),
      thread("no-tokens", {
        latestUserMessageAt: "2026-06-02T09:00:00.000Z",
        cacheHud: cacheHud("2026-06-02T11:59:00.000Z", 5 * 60_000, 0),
      }),
    ];
    expect(ids(sortSidebarConversations(threads, "cache_expiry", NOW))).toEqual([
      "soon-expiry",
      "late-expiry",
      "cold-recent",
      "expired",
      "no-ttl",
      "no-tokens",
    ]);
    // A later clock lets the earlier deadline lapse, so that row falls back to activity order.
    const later = Date.parse("2026-06-02T12:04:00.000Z");
    expect(ids(sortSidebarConversations(threads, "cache_expiry", later)).slice(0, 2)).toEqual([
      "late-expiry",
      "cold-recent",
    ]);
  });

  it("keeps each machine contiguous when grouping by machine", () => {
    const threads = [
      thread("b-new", { environmentId: "env-b", latestUserMessageAt: "2026-06-02T11:00:00.000Z" }),
      thread("a-old", { environmentId: "env-a", latestUserMessageAt: "2026-06-01T11:00:00.000Z" }),
      thread("a-new", { environmentId: "env-a", latestUserMessageAt: "2026-06-02T10:00:00.000Z" }),
    ];
    expect(ids(sortSidebarConversations(threads, "updated_at", NOW, "machine"))).toEqual([
      "a-new",
      "a-old",
      "b-new",
    ]);
    expect(ids(sortSidebarConversations(threads, "updated_at", NOW))).toEqual([
      "b-new",
      "a-new",
      "a-old",
    ]);
  });

  it("returns a stable order regardless of input order and leaves the input untouched", () => {
    const threads = [thread("c"), thread("a"), thread("b")];
    const forward = sortSidebarConversations(threads, "updated_at", NOW);
    const reversed = sortSidebarConversations([...threads].reverse(), "updated_at", NOW);
    expect(ids(forward)).toEqual(["a", "b", "c"]);
    expect(ids(reversed)).toEqual(ids(forward));
    expect(ids(threads)).toEqual(["c", "a", "b"]);
  });
});
