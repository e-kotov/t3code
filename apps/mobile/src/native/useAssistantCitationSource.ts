import type { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import type { AssistantCitationSource } from "./assistantCitationSelection";

export function useAssistantCitationSource(props: {
  readonly environmentId: EnvironmentId;
  readonly citationThreadId?: ThreadId | undefined;
  readonly citationMessageId?: MessageId | undefined;
}): AssistantCitationSource | undefined {
  const { environmentId, citationThreadId: threadId, citationMessageId: messageId } = props;
  return useMemo(
    () =>
      messageId === undefined || threadId === undefined
        ? undefined
        : { environmentId, threadId, messageId },
    [environmentId, threadId, messageId],
  );
}
