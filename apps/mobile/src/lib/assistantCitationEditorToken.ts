import type { composerContextEditorTokens } from "./composerContext";

/** Keep citation display overrides outside the platform editors' native token protocol. */
export function assistantCitationEditorToken<
  T extends { readonly label: string; readonly detail: string },
>(token: ReturnType<typeof composerContextEditorTokens>[number], nativeToken: T) {
  if (token.type !== "assistantCitation") return nativeToken;
  return {
    ...nativeToken,
    label: `“${token.value.replace(/\s+/g, " ").slice(0, 30)}${token.value.length > 30 ? "…" : ""}”`,
    detail: token.citation.comment ? "comment" : "",
  };
}
