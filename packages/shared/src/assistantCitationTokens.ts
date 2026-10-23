import type { AssistantCitation } from "@t3tools/contracts";
import { collectAssistantCitations } from "./assistantCitations.ts";

export interface AssistantCitationToken {
  readonly type: "assistantCitation";
  readonly value: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly citation: AssistantCitation;
}

export function assistantCitationTokens(text: string): AssistantCitationToken[] {
  return collectAssistantCitations(text).map((quote) => ({
    ...quote,
    type: "assistantCitation",
    value: quote.citation.text,
  }));
}
