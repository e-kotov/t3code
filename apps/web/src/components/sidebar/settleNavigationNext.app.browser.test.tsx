import { it } from "vite-plus/test";
import { runSettleNavigationScenario } from "./settleNavigationScenario";

it("opens the next thread when chosen", async () => {
  await runSettleNavigationScenario("next-thread", "next");
});
