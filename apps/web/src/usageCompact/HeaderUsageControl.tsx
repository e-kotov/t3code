import { CompactUsageControl } from "./CompactUsageControl";
import { useHeaderUsage } from "./useHeaderUsage";

/** Remaining quota beside the chat header's panel toggles; click opens the full Usage page. */
export function HeaderUsageControl() {
  return <CompactUsageControl {...useHeaderUsage()} />;
}
