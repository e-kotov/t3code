import { useGT } from "gt-react-native";
import { useMemo } from "react";
import { Platform } from "react-native";
import * as Dialog from "../components/ui/Dialog";
import type { AssistantCitationSource } from "./assistantCitationSelection";
import { emitAssistantCitationSelection } from "./assistantCitationSelection";

export function useAssistantCitationMenu(
  source: AssistantCitationSource | undefined,
  onCiteText?: (text: string) => void,
) {
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
        : Platform.OS === "ios" && onCiteText
          ? [
              {
                text: gt("Cite", { $context: "verb, quote selected text" }),
                icon: "quote.bubble",
                onPress: ({ text }: { text: string }) => onCiteText(text),
              },
            ]
          : undefined,
    [source, onCiteText, gt],
  );
}
