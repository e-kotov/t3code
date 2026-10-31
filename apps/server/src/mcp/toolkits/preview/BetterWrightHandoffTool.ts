import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Tool, Toolkit } from "effect/ai";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { BetterWrightHandoff, BrowserHandoffInput, BrowserHandoffResult } from "../../../preview/BetterWrightHandoff.ts";
export { layer as serviceLayer } from "../../../preview/BetterWrightHandoff.ts";

export const toolkit = Toolkit.make(Tool.make("browser_handoff", {
  description: "Ask the human to operate an EXISTING BetterWright page in T3's browser, including mobile. Get session and pageId from BetterWright's tabs first. Supply the same profile if nondefault. Starts the private viewer automatically and waits for Take control then Release control. No phone terminal or global VPN is needed. Do not drive the page during this call. On return, recheck the SAME page; release is not proof a CAPTCHA succeeded. Unsupported: file upload, downloads and native browser dialogs. A disconnected viewer does not complete the handoff.",
  parameters: BrowserHandoffInput,
  success: BrowserHandoffResult,
  failure: OrchestratorMcpFailure,
  dependencies: [McpInvocationContext.McpInvocationContext, ThreadManagementService.ThreadManagementService, BetterWrightHandoff],
}).annotate(Tool.Title, "Hand browser control to you")
  .annotate(Tool.OpenWorld, true).annotate(Tool.Destructive, false));

export const handlers = McpToolAccess.toLayer(toolkit, {
  browser_handoff: McpToolAccess.actsAsCaller((input) => Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    if (!scope.thread || !scope.capabilities.has("preview")) {
      return yield* new OrchestratorMcpFailure({ code: "capability_denied", message: "Browser handoff needs this thread's preview capability." });
    }
    return yield* (yield* BetterWrightHandoff).request(scope.thread.threadId, input);
  })),
});
