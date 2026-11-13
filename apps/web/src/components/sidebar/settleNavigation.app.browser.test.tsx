import { it } from "vite-plus/test";
import { runSettleNavigationScenario } from "./settleNavigationScenario";

it("stays on the settled thread without a saved choice", async () => {
  await runSettleNavigationScenario(undefined, "settled");
});
