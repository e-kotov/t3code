import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type OrchestrationV2ProviderTurnTokenUsage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { deriveCacheHud, describeCacheHud, presentCacheHud } from "./cacheHud.ts";

const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
const scope = "codex:gpt-6.1-sol";
const driver = ProviderDriverKind.make("codex");
const at = (minutes: number) => DateTime.formatIso(DateTime.makeUnsafe(Date.UTC(2026, 9, 21, 9, minutes)));
const report = (minutes: number, cached = 9_000): OrchestrationV2ProviderTurnTokenUsage => ({
  usedTokens: 10_100, inputTokens: 10_000, cachedInputTokens: cached,
  cacheScopeKey: scope, updatedAt: at(minutes),
});
const resumed = (cached = 8_200): OrchestrationV2ProviderTurnTokenUsage => ({
  ...report(50),
  cacheFirstRequest: { startedAt: at(47), reportedAt: at(48), inputTokens: 10_000, cachedInputTokens: cached },
});

describe("observed Codex cache reuse after a gap", () => {
  it("shows the first response's cached share after a 47-minute gap, independently of later hits", () => {
    const hud = deriveCacheHud(driver, [report(0), resumed()], selection)!;
    expect(hud.resumeObservation).toMatchObject({ gapMs: 47 * 60_000, cachedInputTokens: 8_200 });
    expect(presentCacheHud(hud, Date.parse(at(50))).cacheText).toContain("↩47m:82%");
    expect(describeCacheHud(hud, Date.parse(at(50))).resume).toContain("8200/10000 input tokens from cache (82%)");
    const coldResume = deriveCacheHud(driver, [report(0), resumed(0)], selection)!;
    expect(presentCacheHud(coldResume, Date.parse(at(50))).cacheText).toContain("↩47m:0%");
    expect(coldResume.usage.cachedInputTokens).toBe(9_000);
  });

  it("distinguishes a small positive cache hit from a complete miss", () => {
    const smallHit = resumed(1_024);
    const hud = deriveCacheHud(driver, [report(0), {
      ...smallHit,
      cacheFirstRequest: { ...smallHit.cacheFirstRequest!, inputTokens: 500_000 },
    }], selection)!;
    expect(presentCacheHud(hud, Date.parse(at(50))).cacheText).toContain("↩47m:<1%");
    expect(hud.resumeObservation?.cachedInputTokens).toBe(1_024);
  });

  it("retains a measured resume result when subsequent short-gap turns arrive", () => {
    const hud = deriveCacheHud(driver, [report(0), resumed(), report(52)], selection)!;
    expect(hud.resumeObservation?.gapMs).toBe(47 * 60_000);
  });

  it("does not infer a miss merely because the historical 30-minute reference elapsed", () => {
    const hud = deriveCacheHud(driver, [report(0)], selection)!;
    const view = presentCacheHud(hud, Date.parse(at(40)));
    expect(view.state).toBe("unknown");
    expect(view.cacheText).not.toContain("❄");
    expect(describeCacheHud(hud, Date.parse(at(40))).cache).toBe("30-minute reference elapsed · retention unverified");
  });

  it("does not turn slow responses, missing first-response telemetry or another model into evidence", () => {
    for (const next of [
      report(47),
      { ...resumed(), cacheFirstRequest: { ...resumed().cacheFirstRequest!, startedAt: at(5) } },
      { ...resumed(), cacheScopeKey: "codex:another-model" },
      { ...resumed(), cacheFirstRequest: { ...resumed().cacheFirstRequest!, inputTokens: 100 } },
      { ...resumed(), cacheFirstRequest: { ...resumed().cacheFirstRequest!, reportedAt: at(46) } },
    ]) {
      expect(deriveCacheHud(driver, [report(0), next], selection)?.resumeObservation).toBeUndefined();
    }
  });
});
