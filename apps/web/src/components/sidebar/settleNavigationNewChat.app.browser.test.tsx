import { it } from "vite-plus/test";
import { runSettleNavigationScenario } from "./settleNavigationScenario";

it("opens a new chat in the same project when chosen", async () => {
  await runSettleNavigationScenario("new-chat", "new-chat");
});
