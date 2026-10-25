import type { AssistantCitation } from "@t3tools/contracts";
import { assistantCitationLabel } from "@t3tools/shared/assistantCitations";
import { useNavigation } from "@react-navigation/native";
import { useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { assistantCitationMessageSegments } from "../../lib/assistantCitationMessage";
import { requestAssistantCitationNavigation } from "../../lib/assistantCitationNavigation";

export function AssistantCitationMessage(props: {
  readonly text: string;
  readonly children: (text: string) => ReactNode;
}) {
  const [selected, setSelected] = useState<AssistantCitation | null>(null);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const segments = assistantCitationMessageSegments(props.text);
  if (!segments.some((segment) => segment.kind === "citation")) return props.children(props.text);
  return (
    <View className="gap-2">
      {segments.map((segment) =>
        segment.kind === "text" ? (
          segment.text.trim() ? <View key={segment.key}>{props.children(segment.text)}</View> : null
        ) : (
          <Pressable
            key={segment.key}
            accessibilityRole="button"
            accessibilityLabel={`Quoted assistant text: ${assistantCitationLabel(segment.citation)}`}
            accessibilityHint="Show the quote, comment and source response"
            className="flex-row items-center gap-2 self-start rounded-lg bg-user-bubble-foreground/10 px-2.5 py-2"
            onPress={() => setSelected(segment.citation)}
          >
            <AppText accessible={false} className="text-xl text-user-bubble-foreground">“</AppText>
            <AppText className="shrink text-sm text-user-bubble-foreground" numberOfLines={2}>
              {assistantCitationLabel(segment.citation)}
            </AppText>
          </Pressable>
        ),
      )}
      {selected ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setSelected(null)}>
          <View className="flex-1 justify-end bg-backdrop">
            <Pressable
              className="absolute inset-0"
              accessibilityLabel="Close quote preview"
              onPress={() => setSelected(null)}
            />
            <View className="max-h-[85%] gap-4 rounded-t-3xl bg-screen px-5 pt-5" style={{ paddingBottom: Math.max(insets.bottom, 20) }}>
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
      ) : null}
    </View>
  );
}
