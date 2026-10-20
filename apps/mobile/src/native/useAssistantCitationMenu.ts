import { useMemo } from "react";
import { Platform } from "react-native";
import type { AssistantCitationSource } from "./SelectableMarkdownText.types";
import { emitAssistantCitationSelection } from "./assistantCitationSelection";

export function useAssistantCitationMenu(source: AssistantCitationSource | undefined) {
  return useMemo(
    () =>
      Platform.OS === "android" && source
        ? [{
            text: "Cite",
            icon: "text.quote",
            onPress: ({ text, selection }: {
              text: string;
              selection: { start: number; end: number };
            }) => emitAssistantCitationSelection(source, text, selection),
          }]
        : undefined,
    [source],
  );
}
