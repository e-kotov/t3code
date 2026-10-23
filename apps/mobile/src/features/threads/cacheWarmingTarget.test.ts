import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { resolveCacheWarmingEnvironmentId } from "./cacheWarmingTarget";

const environment = (id: string, label: string) => ({
  environmentId: EnvironmentId.make(id),
  label,
});

it("targets the filtered machine, else the same first machine whatever the list order", () => {
  const byCodeUnit = [environment("mac", "MacBook"), environment("gwdg", "gwdg")];
  const byLocale = [environment("gwdg", "gwdg"), environment("mac", "MacBook")];

  expect(resolveCacheWarmingEnvironmentId(null, byCodeUnit)).toBe("gwdg");
  expect(resolveCacheWarmingEnvironmentId(null, byLocale)).toBe("gwdg");
  expect(resolveCacheWarmingEnvironmentId(EnvironmentId.make("mac"), byLocale)).toBe("mac");
  expect(resolveCacheWarmingEnvironmentId(null, [])).toBeNull();
});

it("breaks a label tie by environment id", () => {
  expect(
    resolveCacheWarmingEnvironmentId(null, [
      environment("b", "Server"),
      environment("a", "Server"),
    ]),
  ).toBe("a");
});
