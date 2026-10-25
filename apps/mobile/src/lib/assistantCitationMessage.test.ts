import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { assistantCitationSourceStep } from "./assistantCitationMessage";

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
