import { ProviderDriverKind } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";
import { compactUsage, groupUsageWindows } from "./usageCompact";

const now = Date.parse("2026-10-26T12:00:00Z");

function account(driver: string, used: number, key = driver): LimitAccount {
  return {
    key,
    driver: ProviderDriverKind.make(driver),
    displayName: null,
    email: undefined,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: {
      checkedAt: "2026-10-26T11:59:00Z",
      windows: [{ id: "session", kind: "session", label: "5h", usedPercent: used }],
    },
  };
}

describe("compact usage", () => {
  it("keeps unavailable providers unknown rather than claiming a full allowance", () => {
    expect(compactUsage([], now).map((provider) => provider.remaining)).toEqual([null, null, null]);
    const unavailable = account("codex", 0);
    expect(
      compactUsage(
        [
          {
            ...unavailable,
            limits: { ...unavailable.limits, unavailable: { reason: "probeFailed" } },
          },
        ],
        now,
      )[0]?.remaining,
    ).toBeNull();
  });

  it("uses the upstream account pool and shows its lowest remaining window", () => {
    const first = account("codex", 20, "one");
    const second = account("codex", 60, "two");
    const weekly = { id: "weekly", kind: "weekly", label: "Week", usedPercent: 75 } as const;
    const result = compactUsage(
      [
        { ...first, limits: { ...first.limits, windows: [...first.limits.windows, weekly] } },
        { ...second, limits: { ...second.limits, windows: [...second.limits.windows, weekly] } },
      ],
      now,
    )[0]!;
    expect(result.remaining).toBe(25);
    expect(result.windows.map((window) => window.remainingPercent)).toEqual([60, 25]);
    expect(result.accounts).toHaveLength(2);
  });

  it("keeps Claude weekly exhaustion visible and Antigravity model quotas separate", () => {
    const claude = account("claudeAgent", 10);
    const agy = account("antigravity", 30);
    const result = compactUsage(
      [
        {
          ...claude,
          limits: {
            ...claude.limits,
            windows: [
              ...claude.limits.windows,
              { id: "seven_day", kind: "weekly", label: "Week", usedPercent: 100 },
            ],
          },
        },
        {
          ...agy,
          limits: {
            ...agy.limits,
            windows: [
              { id: "gemini-pro", kind: "other", label: "Gemini Pro", usedPercent: 40 },
              { id: "claude", kind: "other", label: "Claude", usedPercent: 90 },
            ],
          },
        },
      ],
      now,
    );
    expect(result[1]?.remaining).toBe(0);
    // Antigravity defaults to primary Gemini models
    expect(result[2]?.remaining).toBe(60);
    expect(result[2]?.windows.map((window) => window.label)).toEqual(["Gemini Pro", "Claude"]);

    // When switched to a Claude proxy model, Antigravity reflects the proxy quota
    const proxyResult = compactUsage(
      [
        {
          ...claude,
          limits: {
            ...claude.limits,
            windows: [
              ...claude.limits.windows,
              { id: "seven_day", kind: "weekly", label: "Week", usedPercent: 100 },
            ],
          },
        },
        {
          ...agy,
          limits: {
            ...agy.limits,
            windows: [
              { id: "gemini-pro", kind: "other", label: "Gemini Pro", usedPercent: 40 },
              { id: "claude", kind: "other", label: "Claude", usedPercent: 90 },
            ],
          },
        },
      ],
      now,
      undefined,
      "claude-opus-5-5",
    );
    expect(proxyResult[2]?.remaining).toBe(10);
  });

  it("keeps optional Claude spending out of subscription headlines", () => {
    const claude = account("claudeAgent", 20);
    const monthly = {
      id: "monthly_spend",
      kind: "monthly",
      label: "Monthly spend",
      usedPercent: 100,
    } as const;
    const result = compactUsage(
      [{ ...claude, limits: { ...claude.limits, windows: [...claude.limits.windows, monthly] } }],
      now,
    )[1]!;
    expect(result.remaining).toBe(80);
    expect(result.windows).toHaveLength(2);
    expect(
      compactUsage([{ ...claude, limits: { ...claude.limits, windows: [monthly] } }], now)[1]
        ?.remaining,
    ).toBe(0);
  });

  it("shows only the requested harnesses and keeps authenticated unreadable ones unknown", () => {
    const result = compactUsage([account("codex", 40)], now, new Set(["codex", "antigravity"]));
    expect(result.map((provider) => [provider.label, provider.remaining])).toEqual([
      ["Codex", 60],
      ["Antigravity", null],
    ]);
  });

  it("derives session (5h) and weekly (w) progress bars, keeping single bar for session-only accounts", () => {
    const codexPro = account("codex", 20);
    const codexPlus = {
      ...codexPro,
      limits: {
        ...codexPro.limits,
        windows: [
          ...codexPro.limits.windows,
          { id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 40 },
        ],
      },
    };
    const codexFree = {
      ...account("codex", 0),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [{ id: "monthly", kind: "monthly" as const, label: "Monthly", usedPercent: 35 }],
      },
    };
    const claude = {
      ...account("claudeAgent", 30),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [
          { id: "five_hour", kind: "session" as const, label: "Session", usedPercent: 70 },
          { id: "seven_day", kind: "weekly" as const, label: "Weekly", usedPercent: 45 },
        ],
      },
    };
    const agy = {
      ...account("antigravity", 0),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [
          { id: "gemini-5h", kind: "session" as const, label: "Gemini · 5-hour", usedPercent: 10 },
          {
            id: "gemini-weekly",
            kind: "weekly" as const,
            label: "Gemini · Weekly",
            usedPercent: 20,
          },
          {
            id: "3p-weekly",
            kind: "weekly" as const,
            label: "Claude & GPT · Weekly",
            usedPercent: 40,
          },
        ],
      },
    };

    // Codex Pro has only 5h bar
    const proResult = compactUsage([codexPro], now, new Set(["codex"]))[0]!;
    expect(proResult.bars).toEqual([{ label: "5h", remaining: 80 }]);

    // Codex Plus has 5h and w bars
    const plusResult = compactUsage([codexPlus], now, new Set(["codex"]))[0]!;
    expect(plusResult.bars).toEqual([
      { label: "5h", remaining: 80 },
      { label: "w", remaining: 60 },
    ]);

    // Monthly-only fallback (Free/Go)
    const freeResult = compactUsage([codexFree], now, new Set(["codex"]))[0]!;
    expect(freeResult.bars).toEqual([{ label: "mo", remaining: 65 }]);

    // Claude has 5h and w bars
    const claudeResult = compactUsage([claude], now, new Set(["claudeAgent"]))[0]!;
    expect(claudeResult.bars).toEqual([
      { label: "5h", remaining: 30 },
      { label: "w", remaining: 55 },
    ]);

    // Antigravity defaults to primary Gemini limits (gemini-weekly remaining 80%)
    const agyResult = compactUsage([agy], now, new Set(["antigravity"]))[0]!;
    expect(agyResult.bars).toEqual([
      { label: "5h", remaining: 90 },
      { label: "w", remaining: 80 },
    ]);

    // Switching active model to a 3p proxy model switches Antigravity to 3p-weekly (remaining 60%)
    const agy3pResult = compactUsage([agy], now, new Set(["antigravity"]), "claude-3-5-sonnet")[0]!;
    expect(agy3pResult.bars).toEqual([{ label: "w", remaining: 60 }]);

    // Provider without readable windows has empty bars
    const emptyResult = compactUsage([], now, new Set(["codex"]))[0]!;
    expect(emptyResult.bars).toEqual([]);
  });

  it("switches quota targets dynamically based on the active thread model (Fable, Argon, 3p)", () => {
    const claude = {
      ...account("claudeAgent", 0),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [
          { id: "five_hour", kind: "session" as const, label: "Session", usedPercent: 20 },
          { id: "seven_day", kind: "weekly" as const, label: "Weekly", usedPercent: 40 },
          {
            id: "seven_day_fable",
            kind: "weekly" as const,
            label: "Weekly · Fable",
            usedPercent: 75,
          },
        ],
      },
    };
    const agy = {
      ...account("antigravity", 0),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [
          { id: "gemini-5h", kind: "session" as const, label: "Gemini · 5-hour", usedPercent: 10 },
          {
            id: "gemini-weekly",
            kind: "weekly" as const,
            label: "Gemini · Weekly",
            usedPercent: 30,
          },
          {
            id: "gemini-argon-wtu-weekly",
            kind: "weekly" as const,
            label: "Gemini 4 Argon · Weekly",
            usedPercent: 95,
          },
          {
            id: "3p-weekly",
            kind: "weekly" as const,
            label: "Claude & GPT (shared) · Weekly",
            usedPercent: 60,
          },
        ],
      },
    };

    // Default (no activeModel or standard model)
    const defaultRes = compactUsage([claude, agy], now);
    expect(defaultRes[1]?.bars).toEqual([
      { label: "5h", remaining: 80 },
      { label: "w", remaining: 60 },
    ]);
    expect(defaultRes[2]?.bars).toEqual([
      { label: "5h", remaining: 90 },
      { label: "w", remaining: 70 },
    ]);

    // Active model: Fable
    const fableRes = compactUsage([claude, agy], now, undefined, "claude-fable-5-1");
    expect(fableRes[1]?.bars).toEqual([
      { label: "5h", remaining: 80 },
      { label: "w", remaining: 25 },
    ]);

    // Active model: Argon
    const argonRes = compactUsage([claude, agy], now, undefined, "gemini-4-argon");
    expect(argonRes[2]?.bars).toEqual([{ label: "w", remaining: 5 }]);
    expect(argonRes[2]?.remaining).toBe(5);
  });

  it("does not leak activeModel to other providers when activeDriver is specified (Greptile P2 #2)", () => {
    const agy = {
      ...account("antigravity", 0),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [
          { id: "gemini-5h", kind: "session" as const, label: "Gemini · 5-hour", usedPercent: 10 },
          {
            id: "gemini-weekly",
            kind: "weekly" as const,
            label: "Gemini · Weekly",
            usedPercent: 20,
          },
          {
            id: "3p-weekly",
            kind: "weekly" as const,
            label: "Claude & GPT · Weekly",
            usedPercent: 80,
          },
        ],
      },
    };
    // Codex chat with gpt-6-astra should not switch Antigravity to 3p proxy
    const res = compactUsage([agy], now, new Set(["antigravity"]), "gpt-6-astra", "codex");
    expect(res[0]?.bars).toEqual([
      { label: "5h", remaining: 90 },
      { label: "w", remaining: 80 },
    ]);
    expect(res[0]?.remaining).toBe(80);
  });

  it("returns null remaining and empty bars when an explicit model family has no quota window (Greptile P2 #3)", () => {
    const agyWithoutArgon = {
      ...account("antigravity", 0),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [
          { id: "gemini-5h", kind: "session" as const, label: "Gemini · 5-hour", usedPercent: 10 },
          {
            id: "gemini-weekly",
            kind: "weekly" as const,
            label: "Gemini · Weekly",
            usedPercent: 20,
          },
        ],
      },
    };
    // Selected Argon, but account has no Argon quota reported: must NOT fall back to primary Gemini
    const res = compactUsage(
      [agyWithoutArgon],
      now,
      new Set(["antigravity"]),
      "gemini-4-argon",
      "antigravity",
    );
    expect(res[0]?.bars).toEqual([]);
    expect(res[0]?.remaining).toBeNull();
  });

  it("reflects exhausted quota from other kinds as the limiting allowance (Greptile P2 #4)", () => {
    const olderAgy = {
      ...account("antigravity", 0),
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [
          { id: "gemini-quota", kind: "other" as const, label: "Gemini Quota", usedPercent: 100 },
          {
            id: "gemini-weekly",
            kind: "weekly" as const,
            label: "Gemini · Weekly",
            usedPercent: 20,
          },
        ],
      },
    };
    const res = compactUsage([olderAgy], now, new Set(["antigravity"]));
    // The exhausted generic quota (0% remaining) must be the limiting remaining
    expect(res[0]?.remaining).toBe(0);
  });

  it("groups reported Family · Window labels without renaming other windows", () => {
    const agy = account("antigravity", 0);
    const pool = compactUsage(
      [
        {
          ...agy,
          limits: {
            ...agy.limits,
            windows: [
              { id: "gemini-5h", kind: "session", label: "Gemini · 5-hour", usedPercent: 0 },
              { id: "gemini-weekly", kind: "weekly", label: "Gemini · Weekly", usedPercent: 0 },
              { id: "3p-weekly", kind: "weekly", label: "Claude & GPT · Weekly", usedPercent: 0 },
            ],
          },
        },
        account("codex", 0),
      ],
      now,
    );
    expect(
      groupUsageWindows(pool[2]!.windows).map((group) => [
        group.title,
        group.rows.map((row) => row.label),
      ]),
    ).toEqual([
      ["Gemini", ["5-hour", "Weekly"]],
      ["Claude & GPT", ["Weekly"]],
    ]);
    expect(groupUsageWindows(pool[0]!.windows)).toEqual([
      { title: null, rows: [{ label: "5h", window: pool[0]!.windows[0] }] },
    ]);
  });
});
