import * as Option from "effect/Option";
import { useMemo, type Ref } from "react";
import { assistantCitationSourceReadiness } from "../../lib/assistantCitationMessage";
import { useThreadDetail } from "../../state/use-thread-detail";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { AssistantCitationSynchronization } from "./AssistantCitationSynchronization";
import { ThreadFeed as BaseThreadFeed, type ThreadFeedProps, type ThreadFeedHandle } from "./ThreadFeed";

export type { ThreadFeedHistoryControls, ThreadFeedHandle } from "./ThreadFeed";

export function ThreadFeed(props: ThreadFeedProps & { readonly ref?: Ref<ThreadFeedHandle> }) {
  const detail = useThreadDetail(props);
  const runtime = useRemoteEnvironmentRuntime(props.environmentId);
  const error = Option.getOrNull(detail.error);
  const synchronization = useMemo(
    () => assistantCitationSourceReadiness(detail.status, runtime?.connectionState, error),
    [detail.status, runtime?.connectionState, error],
  );
  return (
    <AssistantCitationSynchronization value={synchronization}>
      <BaseThreadFeed {...props} />
    </AssistantCitationSynchronization>
  );
}
