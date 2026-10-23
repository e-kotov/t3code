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
    ...(comment ? { comment } : {}),
  }));
  if (!token) throw new Error("Missing citation token");
  return token;
}

it("collapses quote whitespace and marks a comment without changing native icons", () => {
  expect(assistantCitationEditorToken(quote("one\n  two", "explain"))).toEqual({
    label: "“one two”",
    detail: "comment",
  });
});

it("truncates a long quote and leaves an uncommented quote detail empty", () => {
  expect(assistantCitationEditorToken(quote("a".repeat(31)))).toEqual({
    label: `“${"a".repeat(30)}…”`,
    detail: "",
  });
});

it("leaves upstream mention presentation intact", () => {
  const [token] = collectComposerInlineTokens("@src/main.ts ");
  if (!token) throw new Error("Missing mention token");
  expect(assistantCitationEditorToken(token)).toEqual({});
});
