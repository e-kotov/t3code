import type { AssistantCitation } from "@t3tools/contracts";
import type { ThreadContentPresentation } from "../features/threads/threadContentPresentation";

interface CitationFeedRow {
  readonly id: string;
  readonly type: string;
  readonly message?: {
    readonly id: string;
    readonly role: string;
    readonly runId?: string | null;
  };
}

export function assistantCitationSourceStep(input: {
  readonly presentation: ThreadContentPresentation;
  readonly foldRunId: (entryId: string) => string | null;
  readonly citation: AssistantCitation;
  readonly feed: ReadonlyArray<CitationFeedRow>;
  readonly visible: ReadonlyArray<CitationFeedRow>;
  readonly history?: {
    readonly hasMoreHistory: boolean;
    readonly loading: boolean;
    readonly error: string | null;
    readonly cursor?: string | null;
  };
  readonly requestedPages: ReadonlySet<string>;
}) {
  if (input.presentation.kind === "loading") return { kind: "wait" } as const;
  if (input.presentation.kind === "unavailable") {
    return { kind: "unavailable", reason: input.presentation.detail } as const;
  }
  const source = input.feed.find(
    (row) => row.type === "message" && row.message?.id === input.citation.messageId,
  );
  if (source) {
    if (source.message?.role !== "assistant") {
      return {
        kind: "unavailable",
        reason: "The citation does not refer to an assistant response.",
      } as const;
    }
    const index = input.visible.findIndex((row) => row.id === source.id);
    if (index >= 0) return { kind: "scroll", index, rowId: source.id } as const;
    const foldRunId = input.foldRunId(source.id);
    if (foldRunId) return { kind: "expand", runId: foldRunId } as const;
    return {
      kind: "unavailable",
      reason: "The cited response is not visible in this thread.",
    } as const;
  }
  if (input.history?.loading) return { kind: "wait" } as const;
  if (input.history?.error) return { kind: "unavailable", reason: input.history.error } as const;
  if (input.history?.hasMoreHistory) {
    const page = input.history.cursor ?? input.feed[0]?.id ?? "initial";
    if (input.requestedPages.size < 20 && !input.requestedPages.has(page)) {
      return { kind: "load", page } as const;
    }
    return {
      kind: "unavailable",
      reason: "Could not load the cited response. Load earlier turns, then try the citation again.",
    } as const;
  }
  return { kind: "unavailable", reason: "The cited response may have been removed." } as const;
}
