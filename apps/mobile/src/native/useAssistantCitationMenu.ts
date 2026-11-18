import { useGT } from "gt-react-native";
import { useMemo } from "react";
import { Platform } from "react-native";
import * as Dialog from "../components/ui/Dialog";
import type { AssistantCitationSource } from "./assistantCitationSelection";
import { emitAssistantCitationSelection } from "./assistantCitationSelection";

export function useAssistantCitationMenu(source: AssistantCitationSource | undefined) {
  const gt = useGT();
  return useMemo(
    () =>
      Platform.OS === "android" && source
        ? [
            {
              text: gt("Cite"),
              icon: "text.quote",
              onPress: ({
                text,
                selection,
                context,
              }: {
                text: string;
                selection: { start: number; end: number };
                context?: { prefix: string; suffix: string };
              }) => {
                const error = emitAssistantCitationSelection(source, text, selection, context);
                if (error) Dialog.alert(gt("Cannot cite selection"), error);
              },
            },
          ]
        : undefined,
    [source, gt],
  );
}
