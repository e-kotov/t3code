import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { cacheWarmingRetired, cacheWarmingWindow } from "./CacheWarmingService.ts";

const NOW = Date.parse("2026-10-11T10:00:00.000Z");
const userMessageAt = DateTime.makeUnsafe(NOW - 60 * 60_000);
const isoAt = (value: number) => DateTime.formatIso(DateTime.makeUnsafe(value));

type WarmThread = Parameters<typeof cacheWarmingWindow>[0]["thread"];

function thread(overrides: Partial<WarmThread> = {}): WarmThread {
  return {
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    archivedAt: null,
    activeRunId: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    lastError: null,
    lastErrorClass: null,
    usageLimitResetAt: null,
    limitRecovery: null,
    status: "completed",
    latestUserAuthoredMessageAt: userMessageAt,
    cacheHud: {
      driver: "codex",
      usage: {
        usedTokens: 12_000,
        inputTokens: 12_000,
        cachedInputTokens: 10_000,
        cacheScopeKey: "codex:gpt-5.4",
        updatedAt: isoAt(NOW - 55 * 60_000),
      },
      ttlMs: 60 * 60_000,
      basis: "estimated",
    },
    ...overrides,
  } as WarmThread;
}

const enabled = { nowMs: NOW, enabled: true } as const;
const fingerprint = `${DateTime.toEpochMillis(userMessageAt)}|${NOW - 55 * 60_000}|codex:gpt-5.4|`;

describe("cacheWarmingWindow", () => {
  it("arms an enabled Codex thread five minutes before its one-hour estimate", () => {
    expect(cacheWarmingWindow({ ...enabled, thread: thread() })).toEqual({
      fingerprint,
      marginMs: 5 * 60_000,
    });
  });

  it("does not warm a thread explicitly settled by the user", () => {
    expect(
      cacheWarmingWindow({ ...enabled, thread: thread({ settledOverride: "settled" }) }),
    ).toBeNull();
  });

  it("does not warm a thread snoozed until later", () => {
    expect(
      cacheWarmingWindow({
        ...enabled,
        thread: thread({ snoozedUntil: DateTime.makeUnsafe(NOW + 60 * 60_000) }),
      }),
    ).toBeNull();
  });

  it("retires warming for settled or still-snoozed threads only", () => {
    const later = DateTime.makeUnsafe(NOW + 60_000);
    const earlier = DateTime.makeUnsafe(NOW - 60_000);
    expect(cacheWarmingRetired({ settledOverride: "settled", snoozedUntil: null }, NOW)).toBe(true);
    expect(cacheWarmingRetired({ settledOverride: null, snoozedUntil: later }, NOW)).toBe(true);
    expect(cacheWarmingRetired({ settledOverride: null, snoozedUntil: earlier }, NOW)).toBe(false);
    expect(cacheWarmingRetired({ settledOverride: "active", snoozedUntil: null }, NOW)).toBe(false);
  });

  it("rearms after fresh cache telemetry reports a new hot window", () => {
    const previous = cacheWarmingWindow({ ...enabled, thread: thread() });
    expect(previous).not.toBeNull();
    const base = thread();
    const refreshed = thread({
      cacheHud: {
        ...base.cacheHud!,
        usage: { ...base.cacheHud!.usage, updatedAt: isoAt(NOW - 56 * 60_000) },
      },
    });
    expect(
      cacheWarmingWindow({
        ...enabled,
        thread: refreshed,
        alreadyWarmedWindow: previous!.fingerprint,
      }),
    ).not.toBeNull();
  });

  it("does not warm outside the margin, after expiry, or after a cold report", () => {
    const base = thread();
    expect(
      cacheWarmingWindow({
        ...enabled,
        thread: thread({
          cacheHud: {
            ...base.cacheHud!,
            usage: { ...base.cacheHud!.usage, updatedAt: isoAt(NOW - 54 * 60_000) },
          },
        }),
      }),
    ).toBeNull();
    expect(
      cacheWarmingWindow({
        ...enabled,
        thread: thread({
          cacheHud: {
            ...base.cacheHud!,
            usage: { ...base.cacheHud!.usage, updatedAt: isoAt(NOW - 60 * 60_000) },
          },
        }),
      }),
    ).toBeNull();
    expect(
      cacheWarmingWindow({
        ...enabled,
        thread: thread({
          cacheHud: {
            ...base.cacheHud!,
            usage: { ...base.cacheHud!.usage, cachedInputTokens: 0, cacheCreationTokens: 0 },
          },
        }),
      }),
    ).toBeNull();
  });

  it("skips when either toggle is off or the thread needs attention", () => {
    const blocked: ReadonlyArray<Partial<WarmThread>> = [
      { activeRunId: "run-1" as never },
      {
        pendingRuntimeRequest: {
          id: "request-1",
          kind: "approval",
          createdAt: userMessageAt,
        } as never,
      },
      { pendingBackgroundTasks: [{ taskId: "task-1", kind: "subagent" }] as never },
      { lastError: "provider failed" },
      { usageLimitResetAt: DateTime.makeUnsafe(NOW + 60_000) as never },
      {
        lineage: {
          rootThreadId: ThreadId.make("thread-1"),
          parentThreadId: null,
          relationshipToParent: "subagent",
        } as never,
      },
    ];
    expect(cacheWarmingWindow({ ...enabled, enabled: false, thread: thread() })).toBeNull();
    expect(
      cacheWarmingWindow({
        ...enabled,
        thread: thread(),
        alreadyWarmedWindow: fingerprint,
      }),
    ).toBeNull();
    for (const override of blocked) {
      expect(cacheWarmingWindow({ ...enabled, thread: thread(override) })).toBeNull();
    }
  });

  it("uses Claude's reported five-minute cache and shorter warm margin", () => {
    const current = thread({
      cacheHud: {
        driver: ProviderDriverKind.make("claudeAgent"),
        usage: {
          usedTokens: 8_000,
          inputTokens: 8_000,
          cachedInputTokens: 6_000,
          cacheScopeKey: "claude:sonnet",
          updatedAt: isoAt(NOW - 4 * 60_000),
        },
        ttlMs: 5 * 60_000,
        basis: "reported",
      },
    });
    expect(cacheWarmingWindow({ ...enabled, thread: current })?.marginMs).toBe(60_000);
  });

  it("leaves other providers unsupported", () => {
    const current = thread({
      cacheHud: { ...thread().cacheHud!, driver: ProviderDriverKind.make("cursor") },
    });
    expect(cacheWarmingWindow({ ...enabled, thread: current })).toBeNull();
  });
});
