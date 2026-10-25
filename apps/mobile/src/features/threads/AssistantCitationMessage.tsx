import type { AssistantCitation } from "@t3tools/contracts";
import { assistantCitationLabel, parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { contextChipPresentation } from "../../lib/composerChipPresentation";
import { contextChipIconSource } from "../../lib/contextChipIconSource";
import { requestAssistantCitationNavigation } from "../../lib/assistantCitationNavigation";
import type { MarkdownLinkCustomization } from "../../native/SelectableMarkdownText.types";

export function useAssistantCitationMessagePreview() {
  const [selected, setSelected] = useState<AssistantCitation | null>(null);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return {
    open: (href: string) => {
      const citation = parseAssistantCitationHref(href);
      if (!citation) return false;
      setSelected(citation);
      return true;
    },
    linkCustomization: (href: string): MarkdownLinkCustomization | undefined => {
      const citation = parseAssistantCitationHref(href);
      if (!citation) return undefined;
      const presentation = contextChipPresentation("assistantCitation");
      return {
        label: assistantCitationLabel(citation),
        ...(presentation.icon ? { icon: contextChipIconSource({ kind: "chip", name: presentation.icon }) } : {}),
        chip: { accent: presentation.accent, tintsIcon: true },
      };
    },
    popup: selected ? (
      <Modal visible transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View className="flex-1 justify-end bg-backdrop">
          <Pressable
            className="absolute inset-0"
            accessibilityLabel="Close quote preview"
            onPress={() => setSelected(null)}
          />
          <View className="gap-4 rounded-t-3xl bg-screen px-5 pt-5" style={{ maxHeight: "85%", paddingBottom: Math.max(insets.bottom, 20) }}>
            <AppText accessibilityRole="header" className="text-lg font-t3-semibold">Quoted assistant text</AppText>
            <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="gap-4" nestedScrollEnabled>
              <View className="border-l-2 border-foreground/30 pl-3">
                <AppText selectable className="text-base text-foreground-secondary">{selected.text}</AppText>
              </View>
              {selected.comment ? <AppText selectable className="text-base text-foreground">{selected.comment}</AppText> : null}
            </ScrollView>
            <Button
              label="Go to source"
              icon="arrow.up.right"
              variant="secondary"
              onPress={() => {
                setSelected(null);
                requestAssistantCitationNavigation(selected);
                navigation.navigate("Thread", {
                  environmentId: String(selected.environmentId),
                  threadId: String(selected.threadId),
                });
              }}
            />
          </View>
        </View>
      </Modal>
    ) : null,
  };
}
