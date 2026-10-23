import type { composerContextEditorTokens } from "./composerContext";

/** Keep citation display overrides outside the platform editors' native token protocol. */
export function assistantCitationEditorToken(
  token: ReturnType<typeof composerContextEditorTokens>[number],
) {
  if (token.type !== "assistantCitation") return {};
  return {
    label: `“${token.value.replace(/\s+/g, " ").slice(0, 30)}${token.value.length > 30 ? "…" : ""}”`,
    detail: token.citation.comment ? "comment" : "",
  };
}
