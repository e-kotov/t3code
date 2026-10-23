import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { expect, it } from "vite-plus/test";
import { assistantCitationEditorToken } from "./assistantCitationEditorToken";

function quote(text: string, comment?: string) {
  const [token] = collectComposerInlineTokens(serializeAssistantCitation({
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
  }));
  if (!token) throw new Error("Missing citation token");
  return token;
}

it("collapses quote whitespace and marks a comment without changing native icons", () => {
  expect(assistantCitationEditorToken(quote("one\n  two", "explain"), { label: "upstream label", detail: "upstream detail", iconUri: "review-comment.svg", tintsIcon: true, futureNativeField: 7 })).toEqual({
    iconUri: "review-comment.svg",
    tintsIcon: true,
    futureNativeField: 7,
    label: "“one two”",
    detail: "comment",
  });
});

it("truncates a long quote and leaves an uncommented quote detail empty", () => {
  expect(assistantCitationEditorToken(quote("a".repeat(31)), { label: "upstream", detail: "upstream" })).toEqual({
    label: `“${"a".repeat(30)}…”`,
    detail: "",
  });
});

it("leaves upstream mention presentation intact", () => {
  const [token] = collectComposerInlineTokens('@"src/main.ts" ');
  if (!token) throw new Error("Missing mention token");
  const payload = { label: "main.ts", detail: "file", iconUri: "typescript.svg", tintsIcon: false };
  expect(assistantCitationEditorToken(token, payload)).toBe(payload);
});
