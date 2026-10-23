import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
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
  readonly cacheServerConfig: EnvironmentServerConfig | null;
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
