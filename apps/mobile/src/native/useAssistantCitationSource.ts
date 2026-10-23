import type { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import type { AssistantCitationSource } from "./SelectableMarkdownText.types";

export function useAssistantCitationSource(
  environmentId: EnvironmentId,
  threadId: ThreadId | undefined,
  messageId: MessageId | undefined,
): AssistantCitationSource | undefined {
  return useMemo(
    () =>
      messageId === undefined || threadId === undefined
        ? undefined
        : { environmentId, threadId, messageId },
    [environmentId, threadId, messageId],
  );
}
