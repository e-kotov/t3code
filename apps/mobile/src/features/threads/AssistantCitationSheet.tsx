import type { AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { assistantCitationCommentError } from "../../lib/assistantCitationDraft";

export function AssistantCitationSheet(props: {
  readonly citation: AssistantCitation;
  readonly mode?: "create" | "edit";
  readonly onCancel: () => void;
  readonly onSubmit: (comment: string) => string | null;
  readonly onRemove?: () => string | null;
}) {
  const [comment, setComment] = useState(
    props.mode === "edit" ? (props.citation.comment ?? "") : "",
  );
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const commentError = assistantCitationCommentError(comment);
  const error = submissionError ?? commentError;
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
            {props.mode === "edit" ? "Edit quote comment" : "Add quote to message"}
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
            onChangeText={(value) => {
              setComment(value);
              setSubmissionError(null);
            }}
          />
          {error ? (
            <AppText className="-mt-2 text-xs text-danger-foreground">{error}</AppText>
          ) : null}
          <View className="flex-row flex-wrap items-center justify-end gap-3">
            {props.mode === "edit" && props.onRemove ? (
              <Pressable
                accessibilityRole="button"
                className="mr-auto min-h-11 justify-center rounded-xl px-4"
                onPress={() => setSubmissionError(props.onRemove?.() ?? null)}
              >
                <AppText className="font-t3-medium text-danger-foreground">Remove quote</AppText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center rounded-xl px-4"
              onPress={props.onCancel}
            >
              <AppText className="font-t3-medium text-foreground-secondary">Cancel</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: commentError !== null }}
              className="min-h-11 justify-center rounded-xl bg-primary px-4"
              disabled={commentError !== null}
              onPress={() => setSubmissionError(props.onSubmit(comment))}
            >
              <AppText className="font-t3-semibold text-primary-foreground">
                {props.mode === "edit" ? "Save" : "Add to prompt"}
              </AppText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
