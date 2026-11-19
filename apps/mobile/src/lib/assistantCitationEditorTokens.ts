import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { composerMathRanges, type ComposerInlineToken } from "@t3tools/shared/composerInlineTokens";

export function assistantCitationEditorRanges(
  text: string,
  tokens: readonly ComposerInlineToken[],
  references: ReadonlyArray<{ readonly start: number; readonly end: number }>,
) {
  const quotes = collectAssistantCitations(text);
  const math = quotes.length > 0 ? composerMathRanges(text, tokens) : [];
  return quotes.filter(
    (quote) =>
      !references.some((ref) => quote.start < ref.end && quote.end > ref.start) &&
      !math.some((range) => quote.start < range.end && quote.end > range.start),
  );
}
