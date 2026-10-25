import { useMemo } from "react";
import { Platform } from "react-native";
import * as Dialog from "../components/ui/Dialog";
import type { AssistantCitationSource } from "./assistantCitationSelection";
import { emitAssistantCitationSelection } from "./assistantCitationSelection";

export function useAssistantCitationMenu(source: AssistantCitationSource | undefined) {
  return useMemo(
    () =>
      Platform.OS === "android" && source
        ? [
            {
              text: "Cite",
              icon: "text.quote",
              onPress: ({
                text,
                selection,
              }: {
                text: string;
                selection: { start: number; end: number };
              }) => {
                const error = emitAssistantCitationSelection(source, text, selection);
                if (error) Dialog.alert("Cannot cite selection", error);
              },
            },
          ]
        : undefined,
    [source],
  );
}
