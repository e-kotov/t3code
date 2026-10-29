import type { ThreadLaunchInput } from "./ThreadLaunchService.ts";

export function normalizeScratchThreadLaunch(
  request: ThreadLaunchInput,
  isScratch: boolean,
): ThreadLaunchInput {
  return isScratch ? { ...request, workspaceStrategy: { type: "root" } } : request;
}
