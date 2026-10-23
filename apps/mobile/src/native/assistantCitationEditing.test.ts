import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { expect, it, vi } from "vite-plus/test";
import { addAssistantCitationEditListener, requestAssistantCitationEdit } from "./assistantCitationEditing";

const source = serializeAssistantCitation({
  version: 1,
  environmentId: EnvironmentId.make("source-environment"),
  threadId: ThreadId.make("source-thread"),
  messageId: MessageId.make("message-1"),
  text: "quoted text", start: 0, end: 11, prefix: "", suffix: "",
});
const selection = { source, start: 5, end: 5 + source.length };

it("opens editing only for the composer that owns the tap", () => {
  const listener = vi.fn();
  const subscription = addAssistantCitationEditListener("draft-1", listener);
  try {
    expect(requestAssistantCitationEdit("draft-2", selection, {}, false)).toBe(false);
    expect(requestAssistantCitationEdit(null, selection, {}, false)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(requestAssistantCitationEdit("draft-1", selection, {}, false)).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith(selection);
  } finally { subscription.remove(); }
});

it.each([
  { editor: { readOnly: true }, importing: false },
  { editor: { editable: false }, importing: false },
  { editor: {}, importing: true },
])("does not open editing while the native editor is locked: %j", ({ editor, importing }) => {
  const listener = vi.fn();
  const subscription = addAssistantCitationEditListener("draft-1", listener);
  try {
    expect(requestAssistantCitationEdit("draft-1", selection, editor, importing)).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  } finally { subscription.remove(); }
});

it("leaves other chip types to the existing context handler", () => {
  const listener = vi.fn();
  const subscription = addAssistantCitationEditListener("draft-1", listener);
  try {
    expect(requestAssistantCitationEdit("draft-1", { source: "@file.ts", start: 0, end: 8 }, {}, false)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  } finally { subscription.remove(); }
});

it("does not let a stale cleanup remove a replacement composer subscription", () => {
  const old = addAssistantCitationEditListener("draft-1", vi.fn());
  old.remove();
  const listener = vi.fn();
  const next = addAssistantCitationEditListener("draft-1", listener);
  try {
    old.remove();
    expect(requestAssistantCitationEdit("draft-1", selection, {}, false)).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith(selection);
  } finally { next.remove(); }
  expect(requestAssistantCitationEdit("draft-1", selection, {}, false)).toBe(false);
});
