import * as Option from "effect/Option";
import { createContext, useContext, useMemo, type ComponentProps, type Ref } from "react";
import { View } from "react-native";
import { assistantCitationSourceReadiness } from "../../lib/assistantCitationMessage";
import { useEnvironmentThread } from "../../state/threads";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { AssistantCitationSynchronization } from "./AssistantCitationSynchronization";
import {
  ThreadFeed as BaseThreadFeed,
  type ThreadFeedProps,
  type ThreadFeedHandle,
} from "./ThreadFeed";

export type { ThreadFeedHistoryControls, ThreadFeedHandle } from "./ThreadFeed";

const CitationComposerReady = createContext(false);

export function CitationThreadDetailView({
  canCiteAssistantText,
  ...props
}: ComponentProps<typeof View> & { readonly canCiteAssistantText: boolean }) {
  return (
    <CitationComposerReady value={canCiteAssistantText}>
      <View {...props} />
    </CitationComposerReady>
  );
}

export function ThreadFeed(props: ThreadFeedProps & { readonly ref?: Ref<ThreadFeedHandle> }) {
  const canCiteAssistantText = useContext(CitationComposerReady);
  const detail = useEnvironmentThread(props.environmentId, props.threadId);
  const runtime = useRemoteEnvironmentRuntime(props.environmentId);
  const error = Option.getOrNull(detail.error);
  const synchronization = useMemo(
    () => assistantCitationSourceReadiness(detail.status, runtime?.connectionState, error),
    [detail.status, runtime?.connectionState, error],
  );
  return (
    <AssistantCitationSynchronization value={synchronization}>
      <BaseThreadFeed {...props} canCiteAssistantText={canCiteAssistantText} />
    </AssistantCitationSynchronization>
  );
}
