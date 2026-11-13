import { createCitationCommentInput } from "~/lib/forkCitationCommentInput";
import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  type AssistantCitation,
  EnvironmentId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { type AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import "~/index.css";
import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ observeSource: vi.fn(), dispose: vi.fn() }));
vi.mock(import("./AssistantCitationSource"), async (importOriginal) => ({
  ...(await importOriginal()),
  observeAssistantCitationCommentSource: mocks.observeSource,
}));
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
  Link: (({ children }: { children: ReactNode }) => <a>{children}</a>) as never,
}));

import { AssistantCitationChip } from "./AssistantCitationChip";

const citation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("source"),
  text: "hello",
  start: 0,
  end: 5,
  prefix: "",
  suffix: "",
};

// The mocked source observer is shared, so every test starts by resetting it.
function setup() {
  mocks.observeSource.mockReset().mockReturnValue(mocks.dispose);
  mocks.dispose.mockClear();
  const source = document.createElement("p");
  source.textContent = "hello";
  document.body.append(source);
  const range = document.createRange();
  range.selectNodeContents(source);
  const sourceAnchor = { source, range, viewport: document.body } as AssistantCitationSourceAnchor;
  return { sourceAnchor, [Symbol.dispose]: () => source.remove() };
}

function mount(
  sourceAnchor: AssistantCitationSourceAnchor | undefined,
  onSave: () => boolean,
  chipCitation: AssistantCitation = citation,
) {
  function Composer() {
    const [open, setOpen] = useState(true);
    return (
      <AssistantCitationChip
        citation={chipCitation}
        commentEditor={{ open, sourceAnchor, onOpenChange: setOpen, onSave }}
      />
    );
  }
  return render(<Composer />);
}

const textarea = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment on selected text"]');

async function removeSource() {
  const { onUnavailable } = mocks.observeSource.mock.lastCall![0];
  await act(async () => onUnavailable());
}

it("focuses an initial comment at the end so typing appends", async () => {
  using source = setup();
  source.sourceAnchor.initialComment = "a";
  source.sourceAnchor.commentInput = createCitationCommentInput("abc");
  await using _screen = await mount(
    source.sourceAnchor,
    vi.fn(() => true),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(textarea()));
  expect(textarea()?.value).toBe("abc");
  expect(source.sourceAnchor.commentInput.pending).toBe(false);
  expect(textarea()?.selectionStart).toBe(3);
  await userEvent.keyboard("de");
  expect(textarea()?.value).toBe("abcde");
});

it("preserves an over-limit seeded comment when its source disappears", async () => {
  using source = setup();
  const onSave = vi.fn(() => true);
  const draft = "x".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH + 1);
  source.sourceAnchor.initialComment = draft;
  await using _screen = await mount(source.sourceAnchor, onSave);
  await removeSource();
  expect(textarea()?.value).toBe(draft);
  expect(onSave).not.toHaveBeenCalled();
});
