import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import type {
  NativeMarkdownTextStyle,
  SelectableMarkdownTextProps,
} from "./SelectableMarkdownText.types";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("gt-react-native", () => ({ useGT: () => (text: string) => text }));
vi.mock("../components/AssistantCitationSheet", () => ({ AssistantCitationSheet: () => null }));
vi.mock("../lib/copyTextWithHaptic", () => ({ copyTextWithHaptic: vi.fn() }));
vi.mock("../lib/useUniwindTheme", () => ({
  useUniwindTheme: () => ({ "--color-focus": "#0088ff" }),
}));
vi.mock("./EnrichedMarkdownText", () => ({
  MobileEnrichedMarkdownText: ({ fileContextMenu, markdown }: SelectableMarkdownTextProps) => {
    const href = markdown.match(/\]\(([^)]+)\)$/)?.[1];
    return <span>{href ? fileContextMenu?.(href)?.title : null}</span>;
  },
}));

import { SelectableMarkdownText } from "./SelectableMarkdownText";

it("only defers citation menus when the parent explicitly owns quote links", () => {
  const marker = serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    text: "quote",
    start: 0,
    end: 5,
    prefix: "",
    suffix: "",
  });
  const props = {
    markdown: marker,
    textStyle: {} as NativeMarkdownTextStyle,
    onLinkPress: vi.fn(),
    fileContextMenu: () => ({ title: "Fork passage", actions: [] }),
  };
  expect(renderToStaticMarkup(<SelectableMarkdownText {...props} />)).toContain("Assistant quote");
  expect(
    renderToStaticMarkup(<SelectableMarkdownText {...props} handlesAssistantCitationLinks />),
  ).toContain("Fork passage");
});
