import { createContext } from "react";
import type { assistantCitationSourceReadiness } from "../../lib/assistantCitationMessage";

export const AssistantCitationSynchronization = createContext<
  ReturnType<typeof assistantCitationSourceReadiness>
>({ kind: "loading" });
