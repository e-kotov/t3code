import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import {
  composerMathRanges,
  type ComposerInlineToken,
} from "@t3tools/shared/composerInlineTokens";

export function assistantCitationEditorTokens(
  text: string,
  tokens: readonly ComposerInlineToken[],
  references: ReadonlyArray<{ readonly start: number; readonly end: number }>,
) {
  const quotes = collectAssistantCitations(text);
  const math = quotes.length > 0 ? composerMathRanges(text, tokens) : [];
  const citations = quotes
    .filter(
      (quote) =>
        !references.some((ref) => quote.start < ref.end && quote.end > ref.start) &&
        !math.some((range) => quote.start < range.end && quote.end > range.start),
    )
    .map((quote) => ({ ...quote, type: "assistantCitation" as const, value: quote.citation.text }));
  return [
    ...tokens.filter(
      (token) => !citations.some((quote) => token.start < quote.end && token.end > quote.start),
    ),
    ...citations,
  ];
}
