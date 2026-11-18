import { LegendList } from "@legendapp/list/react-native";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { T } from "gt-react-native";
import { useGT } from "gt-react-native";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, View, type TextInputInstance } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListSection } from "../../components/ui/ListSection";
import { SearchField } from "../../components/ui/SearchField";
import { Sheet } from "../../components/ui/Sheet";
import {
  filterForkShareThreads,
  type ForkShareDestinationSnapshot,
} from "./forkShareDestinationController";
import { sameForkShareDestination } from "./forkShareDestination";
import { forkShareDestinations, forkShareThreadsAtom } from "./forkShareDestinations";

function DestinationSheet({ snapshot }: { readonly snapshot: ForkShareDestinationSnapshot }) {
  const gt = useGT();
  const threads = useAtomValue(forkShareThreadsAtom);
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInputInstance>(null);
  const controller = forkShareDestinations!;
  const recovery = controller.recovery();
  const reserved = snapshot.share.destination;
  const matches = filterForkShareThreads(threads, query).filter(
    (thread) => !reserved || sameForkShareDestination(reserved, thread),
  );
  const summary =
    snapshot.share.attachments.map((attachment) => attachment.name).join(", ") || "Shared text";
  return (
    <Sheet title={gt("Share to conversation")} onClose={() => controller.close(snapshot.share.id)}>
      <LegendList
        renderScrollComponent={NativeScrollView}
        extraData={gt}
        data={snapshot.busy || snapshot.loadingDrafts ? [] : matches}
        keyExtractor={(thread) => `${thread.environmentId}:${thread.threadId}`}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-2 p-4"
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <AppText textRole="footnote" className="text-foreground-muted">
              {summary}
            </AppText>
            <AppText textRole="footnote" className="text-foreground-muted">
              <T>Choose a draft. Nothing is sent automatically.</T>
            </AppText>
            {snapshot.error ? (
              <AppText className="text-danger-foreground">{snapshot.error}</AppText>
            ) : null}
            {snapshot.busy ? (
              <ListActionRow
                label={
                  snapshot.loadingDrafts
                    ? gt("Loading saved drafts…")
                    : gt("Attaching shared content…")
                }
                loading
                onPress={() => {}}
              />
            ) : snapshot.loadingDrafts ? (
              <ListActionRow
                label={gt("Retry loading saved drafts")}
                onPress={() => controller.reloadDrafts()}
              />
            ) : (
              <>
                {snapshot.retryAvailable ? (
                  <ListActionRow
                    label={gt("Retry import")}
                    onPress={() => void controller.retry()}
                  />
                ) : null}
                <ListSection>
                  {snapshot.current &&
                  (!reserved || sameForkShareDestination(reserved, snapshot.current)) ? (
                    <ListActionRow
                      label={gt("Current conversation")}
                      description={snapshot.current.title}
                      onPress={() => void controller.choose(snapshot.current!)}
                    />
                  ) : null}
                  {!reserved ? (
                    <ListActionRow
                      label={gt("New conversation")}
                      description={gt("Choose a project")}
                      onPress={() => controller.newConversation()}
                    />
                  ) : null}
                </ListSection>
                {reserved ? (
                  <AppText textRole="footnote" className="text-foreground-muted">
                    <T>This share is reserved for the conversation selected earlier.</T>
                  </AppText>
                ) : null}
                <View className="flex-row">
                  <SearchField
                    inputRef={inputRef}
                    autoFocus={false}
                    accessibilityLabel={gt("Find conversation")}
                    clearAccessibilityLabel={gt("Clear search")}
                    placeholder={gt("Find existing conversation")}
                    value={query}
                    onChangeText={setQuery}
                  />
                </View>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <ListActionRow
            label={item.title || gt("Untitled conversation")}
            description={`${item.projectName} · ${item.environmentName}`}
            onPress={() => void controller.choose(item)}
          />
        )}
        ListEmptyComponent={
          snapshot.busy ? undefined : (
            <AppText textRole="footnote" className="text-foreground-muted">
              <T>No matching conversations. Connect to the server to load its conversations.</T>
            </AppText>
          )
        }
        ListFooterComponent={
          snapshot.busy || snapshot.loadingDrafts ? undefined : (
            <ListSection>
              {recovery.merged ? (
                <ListActionRow
                  label={gt("Keep saved draft")}
                  description={gt("Finish saving the content already added to this draft.")}
                  onPress={() => void controller.keepDraft()}
                />
              ) : (
                <>
                  {recovery.destination ? (
                    <ListActionRow
                      label={gt("Choose another conversation")}
                      onPress={() => void controller.changeDestination()}
                    />
                  ) : null}
                  <ListActionRow
                    label={gt("Discard share")}
                    tone="danger"
                    onPress={() => void controller.discard()}
                  />
                </>
              )}
            </ListSection>
          )
        }
      />
    </Sheet>
  );
}

export function ForkShareDestinationHost() {
  const gt = useGT();
  const controller = forkShareDestinations!;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!snapshot) return null;
  return snapshot.visible ? (
    <DestinationSheet key={snapshot.share.id} snapshot={snapshot} />
  ) : (
    <View className="absolute bottom-8 left-4 right-4 rounded-xl bg-grouped-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Resume shared content import")}
        onPress={() => controller.reopen()}
        className="min-h-14 justify-center p-4"
      >
        <AppText>
          {snapshot.busy
            ? gt("Importing shared content…")
            : gt("Shared content waiting. Tap to continue")}
        </AppText>
      </Pressable>
    </View>
  );
}
