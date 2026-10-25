import * as Option from "effect/Option";
import { useMemo } from "react";
import { assistantCitationSourceReadiness } from "../../lib/assistantCitationMessage";
import { useThreadDetail } from "../../state/use-thread-detail";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { AssistantCitationSynchronization } from "./AssistantCitationSynchronization";
import { ThreadFeed, type ThreadFeedProps } from "./ThreadFeed";

export type { ThreadFeedHistoryControls } from "./ThreadFeed";

export function CitationThreadFeed(props: ThreadFeedProps) {
  const detail = useThreadDetail(props);
  const runtime = useRemoteEnvironmentRuntime(props.environmentId);
  const error = Option.getOrNull(detail.error);
  const synchronization = useMemo(
    () => assistantCitationSourceReadiness(detail.status, runtime?.connectionState, error),
    [detail.status, runtime?.connectionState, error],
  );
  return (
    <AssistantCitationSynchronization value={synchronization}>
      <ThreadFeed {...props} />
    </AssistantCitationSynchronization>
  );
}
