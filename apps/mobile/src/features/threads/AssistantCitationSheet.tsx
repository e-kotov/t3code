import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";
import { AppText, AppTextInput } from "../../components/ui/AppText";

export function AssistantCitationSheet(props: {
  readonly citation: AssistantCitation;
  readonly onCancel: () => void;
  readonly onAdd: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const tooLong = comment.length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={props.onCancel}>
      <KeyboardAvoidingView className="flex-1 justify-end bg-backdrop" behavior="padding">
        <Pressable
          accessibilityLabel="Close quote"
          className="absolute inset-0"
          onPress={props.onCancel}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-4 rounded-t-3xl bg-screen px-5 pb-8 pt-5"
          style={{ flexGrow: 0, maxHeight: "90%" }}
        >
          <View className="h-1 w-10 self-center rounded-full bg-border" />
          <AppText accessibilityRole="header" className="text-lg font-t3-semibold">
            Add quote to message
          </AppText>
          <View className="max-h-28 rounded-2xl bg-subtle px-3.5 py-3">
            <AppText className="text-sm text-foreground-secondary" numberOfLines={4}>
              {props.citation.text}
            </AppText>
          </View>
          <AppTextInput
            accessibilityLabel="Comment on quoted text"
            accessibilityHint="Optional comment to send with this quote"
            className="min-h-24"
            multiline
            textAlignVertical="top"
            placeholder="Add an optional comment…"
            value={comment}
            onChangeText={setComment}
            maxLength={ASSISTANT_CITATION_MAX_COMMENT_LENGTH + 1}
          />
          {tooLong ? (
            <AppText className="-mt-2 text-xs text-danger-foreground">
              The comment is too long.
            </AppText>
          ) : null}
          <View className="flex-row justify-end gap-3">
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center rounded-xl px-4"
              onPress={props.onCancel}
            >
              <AppText className="font-t3-medium text-foreground-secondary">Cancel</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: tooLong }}
              className="min-h-11 justify-center rounded-xl bg-primary px-4"
              disabled={tooLong}
              onPress={() => props.onAdd(comment)}
            >
              <AppText className="font-t3-semibold text-primary-foreground">Add to prompt</AppText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
