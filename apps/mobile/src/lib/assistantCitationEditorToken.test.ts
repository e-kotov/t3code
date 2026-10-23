import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { expect, it } from "vite-plus/test";
import { assistantCitationEditorToken } from "./assistantCitationEditorToken";
import { composerContextEditorTokens } from "./composerContext";

function quote(text: string, comment?: string) {
  const marker = serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make("message-1"),
    text,
    start: 0,
    end: text.length,
    prefix: "",
    suffix: "",
    ...(comment ? { comment } : {}),
  });
  const [token] = composerContextEditorTokens(
    marker,
    collectComposerInlineTokens(marker),
    new Map(),
  );
  if (!token) throw new Error("Missing citation token");
  return token;
}

it("shows the comment without changing native icons", () => {
  expect(
    assistantCitationEditorToken(quote("one\n  two", "explain"), {
      label: "upstream label",
      detail: "upstream detail",
      iconUri: "review-comment.svg",
      tintsIcon: true,
      futureNativeField: 7,
    }),
  ).toEqual({
    iconUri: "review-comment.svg",
    tintsIcon: true,
    futureNativeField: 7,
    label: "explain",
    detail: "",
  });
});

it("truncates a long quote and leaves an uncommented quote detail empty", () => {
  expect(
    assistantCitationEditorToken(quote("a".repeat(31)), { label: "upstream", detail: "upstream" }),
  ).toEqual({
    label: `“${"a".repeat(30)}…”`,
    detail: "",
  });
});

it("preserves surrogate pairs and does not truncate a short quote with repeated whitespace", () => {
  expect(
    assistantCitationEditorToken(quote(`${"a".repeat(29)}🚀tail`), {
      label: "upstream",
      detail: "upstream",
    }),
  ).toEqual({ label: `“${"a".repeat(29)}🚀…”`, detail: "" });
  expect(
    assistantCitationEditorToken(quote(`one${" ".repeat(40)}two`), {
      label: "upstream",
      detail: "upstream",
    }),
  ).toEqual({ label: "“one two”", detail: "" });
});

it("leaves upstream mention presentation intact", () => {
  const [token] = collectComposerInlineTokens('@"src/main.ts" ');
  if (!token) throw new Error("Missing mention token");
  const payload = { label: "main.ts", detail: "file", iconUri: "typescript.svg", tintsIcon: false };
  expect(assistantCitationEditorToken(token, payload)).toBe(payload);
});
