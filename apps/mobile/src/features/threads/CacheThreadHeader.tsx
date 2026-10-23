import type { ServerConfig } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ComponentProps } from "react";
import { CacheHud } from "./CacheHud";
import { ThreadHeader } from "./ThreadHeader";

export function CacheThreadHeader({
  cacheThread,
  cacheServerConfig,
  ...props
}: ComponentProps<typeof ThreadHeader> & {
  readonly cacheThread: Pick<EnvironmentThreadShell, "cacheHud" | "modelSelection">;
  readonly cacheServerConfig: ServerConfig | null;
}) {
  return (
    <>
      <ThreadHeader {...props} />
      <CacheHud
        hud={cacheThread.cacheHud}
        modelLabel={cacheThread.modelSelection.model}
        usageWindows={
          cacheServerConfig?.providers.find(
            (provider) => provider.instanceId === cacheThread.modelSelection.instanceId,
          )?.usageLimits?.windows
        }
      />
    </>
  );
}
