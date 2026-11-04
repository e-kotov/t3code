import { describe, expect, it } from "vite-plus/test";

import {
  initialStreamHealth,
  streamConnectionChanged,
  streamFramed,
  streamNeedsFallback,
  streamRefused,
} from "./betterWrightSshFallbackHealth";

describe("browser stream health for the SSH fallback", () => {
  it("offers the fallback for a stream that never paints, stays down, or keeps dropping", () => {
    const painted = streamFramed(streamConnectionChanged(initialStreamHealth(0), true, 100));
    expect(streamNeedsFallback(painted, 600_000)).toBe(false);

    const blank = streamConnectionChanged(initialStreamHealth(0), true, 1_000);
    expect(streamNeedsFallback(blank, 12_000)).toBe(false);
    expect(streamNeedsFallback(blank, 13_000)).toBe(true);

    const down = streamConnectionChanged(painted, false, 10_000);
    expect(streamNeedsFallback(down, 15_000)).toBe(false);
    expect(streamNeedsFallback(down, 16_000)).toBe(true);
    expect(streamNeedsFallback(streamConnectionChanged(down, true, 12_000), 60_000)).toBe(false);

    let flapping = painted;
    for (const at of [20_000, 21_000, 22_000]) {
      flapping = streamConnectionChanged(
        streamConnectionChanged(flapping, false, at),
        true,
        at + 500,
      );
    }
    expect(streamNeedsFallback(flapping, 23_000)).toBe(true);
    expect(streamNeedsFallback(flapping, 60_000)).toBe(false);
  });

  it("never treats a credential refusal as a stream failure", () => {
    const refused = streamRefused(initialStreamHealth(0));
    expect(streamNeedsFallback(refused, 600_000)).toBe(false);
    const recovered = streamConnectionChanged(refused, true, 1_000);
    expect(recovered.refusing).toBe(false);
    expect(
      streamNeedsFallback(streamRefused(streamConnectionChanged(recovered, false, 2_000)), 60_000),
    ).toBe(false);
  });
});
