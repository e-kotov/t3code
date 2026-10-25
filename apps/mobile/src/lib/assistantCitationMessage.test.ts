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
  const ready = { presentation: { kind: "ready" } as const, foldRunId: () => "run" };
  const source = {
    id: "source-row",
    type: "message",
    message: { id: "assistant", role: "assistant", runId: "run" },
  };

  it("waits for source content before deciding a response was removed", () => {
    const input = { ...ready, citation, feed: [], visible: [], requestedPages: new Set<string>() };
    expect(assistantCitationSourceStep({ ...input, presentation: { kind: "loading" } })).toEqual({ kind: "wait" });
    expect(assistantCitationSourceStep({ ...input, presentation: { kind: "unavailable", title: "Offline", detail: "Reconnect to load this thread." } })).toEqual({ kind: "unavailable", reason: "Reconnect to load this thread." });
    expect(assistantCitationSourceStep({ ...input, feed: [source], visible: [source] })).toEqual({ kind: "scroll", index: 0, rowId: "source-row" });
  });

  it("uses the fold owner for runless and resumed source responses", () => {
    for (const runId of [null, "resumed-run"]) {
      const hidden = { ...source, message: { ...source.message, runId } };
      expect(assistantCitationSourceStep({
        ...ready,
        citation,
        feed: [hidden],
        visible: [],
        requestedPages: new Set(),
        foldRunId: () => "original-fold",
      })).toEqual({ kind: "expand", runId: "original-fold" });
    }
  });

  it("locates the original response by message identity rather than a repeated quote", () => {
    const other = { ...source, id: "other-row", message: { ...source.message, id: "other" } };
    expect(
      assistantCitationSourceStep({
        ...ready,
        citation,
        feed: [other, source],
        visible: [other, source],
        requestedPages: new Set(),
      }),
    ).toEqual({ kind: "scroll", index: 1, rowId: "source-row" });
  });

  it("expands a folded source turn before scrolling", () => {
    expect(
      assistantCitationSourceStep({
        ...ready,
        citation,
        feed: [source],
        visible: [],
        requestedPages: new Set(),
      }),
    ).toEqual({ kind: "expand", runId: "run" });
  });

  it("loads history once per boundary and waits for an in-flight page", () => {
    const input = {
      ...ready,
      citation,
      feed: [],
      visible: [],
      requestedPages: new Set<string>(),
      history: { hasMoreHistory: true, loading: false, error: null },
    };
    expect(assistantCitationSourceStep(input)).toEqual({ kind: "load", page: "initial" });
    expect(
      assistantCitationSourceStep({ ...input, history: { ...input.history, loading: true } }),
    ).toEqual({ kind: "wait" });
    expect(
      assistantCitationSourceStep({ ...input, requestedPages: new Set(["initial"]) }).kind,
    ).toBe("unavailable");
  });

  it("bounds history requests and reports deleted or non-assistant source messages", () => {
    const input = { ...ready, citation, feed: [], visible: [], requestedPages: new Set<string>() };
    expect(assistantCitationSourceStep(input).kind).toBe("unavailable");
    expect(
      assistantCitationSourceStep({
        ...ready,
        ...input,
        requestedPages: new Set(Array.from({ length: 20 }, (_, index) => String(index))),
        history: { hasMoreHistory: true, loading: false, error: null },
      }).kind,
    ).toBe("unavailable");
    expect(
      assistantCitationSourceStep({
        ...ready,
        ...input,
        feed: [{ ...source, message: { ...source.message, role: "user" } }],
      }).kind,
    ).toBe("unavailable");
  });

  it("keeps loading when the history cursor advances without a new visible top row", () => {
    expect(assistantCitationSourceStep({
      ...ready,
      citation,
      feed: [],
      visible: [],
      history: { hasMoreHistory: true, loading: false, error: null, cursor: "page-2" },
      requestedPages: new Set(["page-1"]),
    })).toEqual({ kind: "load", page: "page-2" });
  });
});
