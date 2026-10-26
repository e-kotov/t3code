import { ProviderDriverKind } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";
import { compactUsage } from "./usageCompact";

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
    expect(result[2]?.remaining).toBe(10);
    expect(result[2]?.windows.map((window) => window.label)).toEqual(["Gemini Pro", "Claude"]);
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
});
