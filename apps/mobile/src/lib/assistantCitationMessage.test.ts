import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";
import { assistantCitationMessageSegments, assistantCitationSourceStep } from "./assistantCitationMessage";

const citation: AssistantCitation = {
  version: 1,
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("assistant"),
  text: "Selected assistant words",
  comment: "Please explain this",
  start: 0,
  end: 24,
  prefix: "",
  suffix: "",
};

describe("sent assistant citations", () => {
  it("keeps full quotes, comments and surrounding message text separate", () => {
    const marker = serializeAssistantCitation(citation);
    expect(assistantCitationMessageSegments(`Before ${marker} after`)).toEqual([
      { kind: "text", key: 0, text: "Before " },
      { kind: "citation", key: 7, citation },
      { kind: "text", key: 7 + marker.length, text: " after" },
    ]);
  });

  it("preserves repeated chips and leaves invalid links as ordinary message text", () => {
    const marker = serializeAssistantCitation(citation);
    const segments = assistantCitationMessageSegments(`${marker}\n${marker}`);
    expect(segments.filter((segment) => segment.kind === "citation")).toHaveLength(2);
    expect(new Set(segments.map((segment) => segment.key)).size).toBe(3);
    const invalid = "[Assistant quote](t3-citation://v1/invalid)";
    expect(assistantCitationMessageSegments(invalid)).toEqual([{ kind: "text", key: 0, text: invalid }]);
  });
});

describe("citation source navigation", () => {
  const source = { id: "source-row", type: "message", message: { id: "assistant", role: "assistant", runId: "run" } };

  it("locates the original response by message identity rather than a repeated quote", () => {
    const other = { ...source, id: "other-row", message: { ...source.message, id: "other" } };
    expect(assistantCitationSourceStep({ citation, feed: [other, source], visible: [other, source], requestedPages: new Set() })).toEqual({ kind: "scroll", index: 1, rowId: "source-row" });
  });

  it("expands a folded source turn before scrolling", () => {
    expect(assistantCitationSourceStep({ citation, feed: [source], visible: [], requestedPages: new Set() })).toEqual({ kind: "expand", runId: "run" });
  });

  it("loads history once per boundary and waits for an in-flight page", () => {
    const input = { citation, feed: [], visible: [], requestedPages: new Set<string>(), history: { hasMoreHistory: true, loading: false, error: null } };
    expect(assistantCitationSourceStep(input)).toEqual({ kind: "load", page: "initial" });
    expect(assistantCitationSourceStep({ ...input, history: { ...input.history, loading: true } })).toEqual({ kind: "wait" });
    expect(assistantCitationSourceStep({ ...input, requestedPages: new Set(["initial"]) }).kind).toBe("unavailable");
  });

  it("bounds history requests and reports deleted or non-assistant source messages", () => {
    const input = { citation, feed: [], visible: [], requestedPages: new Set<string>() };
    expect(assistantCitationSourceStep(input).kind).toBe("unavailable");
    expect(assistantCitationSourceStep({ ...input, requestedPages: new Set(Array.from({ length: 20 }, (_, index) => String(index))), history: { hasMoreHistory: true, loading: false, error: null } }).kind).toBe("unavailable");
    expect(assistantCitationSourceStep({ ...input, feed: [{ ...source, message: { ...source.message, role: "user" } }] }).kind).toBe("unavailable");
  });
});
