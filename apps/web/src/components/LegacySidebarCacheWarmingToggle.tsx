import type { EnvironmentId } from "@t3tools/contracts";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useThreadShells } from "../state/entities";
import { CacheWarmingEnvironmentToggle } from "./CacheWarmingToggle";

export function LegacySidebarCacheWarmingToggle(props: { environmentId: EnvironmentId | null }) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useThreadShells();
  const environmentId = props.environmentId ?? primaryEnvironmentId;
  return (
    <CacheWarmingEnvironmentToggle
      environmentId={environmentId}
      threads={threads.filter((thread) => thread.environmentId === environmentId)}
    />
  );
}
