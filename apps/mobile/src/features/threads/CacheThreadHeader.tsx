import { focusedCacheHud } from "@t3tools/shared/cacheHud";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import type { EnvironmentThreadStructure } from "@t3tools/client-runtime/state/models";
import { environmentThreadDetails } from "../../state/threads";
import { useThreadSelection } from "../../state/use-thread-selection";
import type { ServerConfig } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ComponentProps } from "react";
import { CacheHud } from "./CacheHud";
import { ThreadHeader } from "./ThreadHeader";

const emptyDetail = Atom.make<EnvironmentThreadStructure | null>(null);

export function CacheThreadHeader({
  cacheThread,
  cacheServerConfig,
  ...props
}: Omit<ComponentProps<typeof ThreadHeader>, "children"> & {
  readonly cacheThread: Pick<EnvironmentThreadShell, "cacheHud" | "modelSelection">;
  readonly cacheServerConfig: ServerConfig | null;
}) {
  const { selectedThreadDetailRef } = useThreadSelection();
  const detail = useAtomValue(
    selectedThreadDetailRef === null
      ? emptyDetail
      : environmentThreadDetails.quietThreadAtom(selectedThreadDetailRef),
  );
  const hud = focusedCacheHud(cacheThread.cacheHud, detail?.projection);
  return (
    <ThreadHeader {...props}>
      <CacheHud
        hud={hud}
        modelLabel={cacheThread.modelSelection.model}
        usageWindows={
          cacheServerConfig?.providers.find(
            (provider) => provider.instanceId === cacheThread.modelSelection.instanceId,
          )?.usageLimits?.windows
        }
      />
    </ThreadHeader>
  );
}
