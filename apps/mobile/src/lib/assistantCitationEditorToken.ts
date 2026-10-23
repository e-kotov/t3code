import type { composerContextEditorTokens } from "./composerContext";

export function assistantCitationEditorToken<
  T extends { readonly label: string; readonly detail: string },
>(token: ReturnType<typeof composerContextEditorTokens>[number], nativeToken: T) {
  if (token.type !== "assistantCitation") return nativeToken;
  const comment = token.citation.comment?.trim();
  const characters = Array.from((comment || token.value).replace(/\s+/g, " "));
  const preview = `${characters.slice(0, 30).join("")}${characters.length > 30 ? "…" : ""}`;
  return {
    ...nativeToken,
    label: comment ? preview : `“${preview}”`,
    detail: "",
  };
}
