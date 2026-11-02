import { CompactUsageControl } from "./CompactUsageControl";
import { useHeaderUsage } from "./useHeaderUsage";

/** Remaining quota beside the chat header panel toggles; click opens the full Usage page. */
export function HeaderUsageControl({
  activeModel,
  activeDriver,
}: {
  activeModel?: string | null | undefined;
  activeDriver?: string | null | undefined;
} = {}) {
  const usage = useHeaderUsage();
  return (
    <CompactUsageControl
      {...usage}
      activeModel={activeModel !== undefined ? activeModel : usage.activeModel}
      activeDriver={activeDriver !== undefined ? activeDriver : usage.activeDriver}
    />
  );
}
