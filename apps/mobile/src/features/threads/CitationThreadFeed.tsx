import { useMessages } from "gt-react-native";
import * as Option from "effect/Option";
import { useMemo } from "react";
import { assistantCitationSourceReadiness } from "../../lib/assistantCitationMessage";
import { useEnvironmentThread } from "../../state/threads";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { AssistantCitationSynchronization } from "./AssistantCitationSynchronization";
import { ThreadFeed as BaseThreadFeed, type ThreadFeedProps } from "./ThreadFeed";

export type { ThreadFeedHistoryControls } from "./ThreadFeed";

export function ThreadFeed(props: ThreadFeedProps) {
  const m = useMessages();
  const detail = useEnvironmentThread(props.environmentId, props.threadId);
  const runtime = useRemoteEnvironmentRuntime(props.environmentId);
  const error = Option.getOrNull(detail.error);
  const synchronization = useMemo(
    () => assistantCitationSourceReadiness(detail.status, runtime?.connectionState, error, m),
    [detail.status, runtime?.connectionState, error, m],
  );
  return (
    <AssistantCitationSynchronization value={synchronization}>
      <BaseThreadFeed {...props} />
    </AssistantCitationSynchronization>
  );
}
