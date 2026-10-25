import type { AssistantCitation } from "@t3tools/contracts";
import {
  assistantCitationLabel,
  parseAssistantCitationHref,
} from "@t3tools/shared/assistantCitations";
import { StackActions, useNavigation } from "@react-navigation/native";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { Keyboard, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { contextChipPresentation } from "../../lib/composerChipPresentation";
import { contextChipIconSource } from "../../lib/contextChipIconSource";
import { requestAssistantCitationNavigation } from "../../lib/assistantCitationNavigation";
import type { MarkdownLinkCustomization } from "../../native/SelectableMarkdownText.types";

import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { PresentationSource } from "../../components/ui/NativePresentation";
import * as Dialog from "../../components/ui/Dialog";
import type { MarkdownFileContextMenu } from "../../native/SelectableMarkdownText.types";

const CitationPreviewContext = createContext<((citation: AssistantCitation) => void) | null>(null);

function AssistantCitationPreviewProvider(props: { readonly children: ReactNode }) {
  const [selected, setSelected] = useState<AssistantCitation | null>(null);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return (
    <CitationPreviewContext value={setSelected}>
      {props.children}
      {selected ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setSelected(null)}>
          <View className="flex-1 justify-end bg-backdrop">
            <Pressable
              className="absolute inset-0"
              accessibilityLabel="Close quote preview"
              onPress={() => setSelected(null)}
            />
            <View
              className="gap-4 rounded-t-3xl bg-screen px-5 pt-5"
              style={{ maxHeight: "85%", paddingBottom: Math.max(insets.bottom, 20) }}
            >
              <AppText accessibilityRole="header" className="text-lg font-t3-semibold">
                Quoted assistant text
              </AppText>
              <ScrollView
                style={{ flexShrink: 1 }}
                contentContainerClassName="gap-4"
                nestedScrollEnabled
              >
                <View className="border-l-2 border-foreground/30 pl-3">
                  <AppText selectable className="text-base text-foreground-secondary">
                    {selected.text}
                  </AppText>
                </View>
                {selected.comment ? (
                  <AppText selectable className="text-base text-foreground">
                    {selected.comment}
                  </AppText>
                ) : null}
              </ScrollView>
              <Button
                label="Go to source"
                icon="arrow.up.right"
                tone="secondary"
                onPress={() => {
                  setSelected(null);
                  requestAssistantCitationNavigation(selected);
                  const target = {
                    environmentId: String(selected.environmentId),
                    threadId: String(selected.threadId),
                  };
                  const state = navigation.getState();
                  const current = state?.routes[state.index];
                  const params = current?.params as ReactNavigation.RootParamList["Thread"];
                  if (
                    current?.name !== "Thread" ||
                    params?.environmentId !== target.environmentId ||
                    params?.threadId !== target.threadId
                  ) {
                    navigation.dispatch(StackActions.push("Thread", target));
                  }
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </CitationPreviewContext>
  );
}

export function AssistantCitationPresentationSource(
  props: ComponentProps<typeof PresentationSource>,
) {
  return (
    <AssistantCitationPreviewProvider>
      <PresentationSource {...props} />
    </AssistantCitationPreviewProvider>
  );
}

export function useAssistantCitationMessagePreview() {
  const select = useContext(CitationPreviewContext);
  const open = (href: string) => {
    const citation = parseAssistantCitationHref(href);
    if (!citation || !select) return false;
    Keyboard.dismiss();
    select(citation);
    return true;
  };
  return {
    open,
    linkCustomization: (href: string): MarkdownLinkCustomization | undefined => {
      const citation = parseAssistantCitationHref(href);
      if (!citation || !select) return undefined;
      const presentation = contextChipPresentation("assistantCitation");
      return {
        label: assistantCitationLabel(citation),
        ...(presentation.icon
          ? { icon: contextChipIconSource({ kind: "chip", name: presentation.icon }) }
          : {}),
        chip: { accent: presentation.accent, tintsIcon: true },
      };
    },
    contextMenu: (href: string): MarkdownFileContextMenu | undefined =>
      parseAssistantCitationHref(href)
        ? {
            title: "Assistant quote",
            actions: [
              { id: "view-assistant-quote", title: "View quote" },
              { id: "copy-assistant-quote", title: "Copy quote text" },
            ],
          }
        : undefined,
    onMenuAction: (href: string, actionId: string) => {
      const citation = parseAssistantCitationHref(href);
      if (!citation) return false;
      if (actionId === "view-assistant-quote") return open(href);
      if (actionId !== "copy-assistant-quote") return false;
      void tryCopyTextWithHaptic(citation.text, { target: "quote" }).then((copied) => {
        if (!copied) Dialog.alert("Could not copy quote", "Try copying the quote again.");
      });
      return true;
    },
  };
}
