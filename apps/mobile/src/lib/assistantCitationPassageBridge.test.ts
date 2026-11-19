import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import {
  collectAssistantCitations,
  expandAssistantCitationsForProvider,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { expect, it } from "vite-plus/test";
import { collectMobileAssistantTextSelectors } from "./assistantCitationSelection";

// Synthetic only. Models CitationPassageText.find, not rendering, Android views, or scroll.
function findAndroidText(
  raw: string,
  wanted: Pick<AssistantCitation, "text" | "prefix" | "suffix">,
) {
  const whitespace = /[\t\n\v\f\r \p{Z}\uFEFF]+/gu;
  const normalize = (text: string) => text.replace(whitespace, " ");
  const text = normalize(raw);
  const quote = normalize(wanted.text);
  const prefix = normalize(wanted.prefix);
  const suffix = normalize(wanted.suffix);
  if (!quote.trim()) return null;
  const matches: number[] = [];
  const contextual: number[] = [];
  for (let start = text.indexOf(quote); start >= 0; start = text.indexOf(quote, start + 1)) {
    const end = start + quote.length;
    matches.push(start);
    if (
      text.slice(Math.max(0, start - prefix.length), start) === prefix &&
      text.slice(end, end + suffix.length) === suffix
    )
      contextual.push(start);
  }
  return contextual.length === 1
    ? contextual[0]
    : contextual.length === 0 && matches.length === 1
      ? matches[0]
      : null;
}

function pick(markdown: string, path: string, text: string, index = 0) {
  const choice = collectMobileAssistantTextSelectors(markdown, path, text)[index];
  if (!choice) throw new Error("Upstream selector did not locate fixture text");
  return choice.selector;
}

it("bridges repeated text when synthetic row views preserve the selector's context", () => {
  const row = "first quote then quote last";
  const markdown = "first **quote then** quote last";
  for (const [choice, expected] of [row.indexOf("quote"), row.lastIndexOf("quote")].entries()) {
    const selector = pick(markdown, "0:0", "quote", choice);
    const marker = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("remote"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("message"),
      ...selector,
    });
    const [parsed] = collectAssistantCitations(marker);
    expect(findAndroidText(row, parsed!.citation)).toBe(expected);
  }
  const crossStyle = "quote then quote";
  expect(findAndroidText(row, pick(markdown, "0:0", crossStyle))).toBe(row.indexOf(crossStyle));
  const folded =
    "Before quote\n\n<details><summary>More</summary>\n\nInside quote after\n\n</details>";
  const visibleOpenedRow = "Before quote\nInside quote after";
  expect(findAndroidText(visibleOpenedRow, pick(folded, "1/0:0", "quote"))).toBe(
    "Before quote Inside quote after".lastIndexOf("quote"),
  );
  const identical = `${"x".repeat(40)}quote${"x".repeat(40)}`;
  expect(
    findAndroidText(
      `${identical}\n${identical}`,
      pick(`${identical}\n\n${identical}`, "0:0", "quote", 1),
    ),
  ).toBeNull();
});

it("bridges image exclusion, table-cell boundaries, and compatible math text", () => {
  expect(
    findAndroidText(
      "before quote after",
      pick("![alt](image.png)\n\nbefore quote after", "0:0", "quote"),
    ),
  ).toBe(7);
  const table = "| column | more |\n| --- | --- |\n| first quote | last quote |";
  const visibleCells = "column\nmore\nfirst quote\nlast quote";
  expect(findAndroidText(visibleCells, pick(table, "0:0", "quote", 1))).toBe(
    "column more first quote last quote".lastIndexOf("quote"),
  );
  const math = "before $x$ quote and then $y$ quote";
  const visibleMath = "before \\(x\\) quote and then \\(y\\) quote";
  expect(findAndroidText(visibleMath, pick(math, "0:0", "quote", 1))).toBe(
    visibleMath.lastIndexOf("quote"),
  );
  // An alternative native math representation cannot disambiguate these two occurrences.
  expect(
    findAndroidText("before x quote and then y quote", pick(math, "0:0", "quote", 1)),
  ).toBeNull();
});

it("opens a pre-upstream marker with its comment without rewriting the draft or provider payload", () => {
  const old = {
    version: 1 as const,
    environmentId: EnvironmentId.make("remote"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    text: "quote",
    start: 0,
    end: 5,
    prefix: "Inside ",
    suffix: " after",
    comment: "Please explain",
  };
  const marker =
    "[Assistant quote](t3-citation://v1/remote/thread/message?text=quote&start=0&end=5&prefix=Inside+&suffix=+after&comment=Please+explain)";
  expect(serializeAssistantCitation(old)).toBe(marker);
  const [parsed] = collectAssistantCitations(marker);
  expect(parsed?.citation).toEqual(old);
  const visible = "Before quote\nInside quote after";
  expect(findAndroidText(visible, parsed!.citation)).toBe(
    "Before quote Inside quote after".lastIndexOf("quote"),
  );
  expect(expandAssistantCitationsForProvider(marker)).toContain("Please explain");
});

it("documents the current matcher limit when the cited fold is collapsed", () => {
  const folded =
    "Before quote\n\n<details><summary>More</summary>\n\nInside quote after\n\n</details>";
  const selector = pick(folded, "1/0:0", "quote");
  // Current native matcher falls back to a single visible quote without context. This is a different source.
  expect(findAndroidText("Before quote", selector)).toBe(7);
});
