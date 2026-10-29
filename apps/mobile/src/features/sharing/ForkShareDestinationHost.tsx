import { useAtomValue } from "@effect/atom-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { FlatList, Pressable, View, type TextInputInstance } from "react-native";

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
    <Sheet title="Share to conversation" onClose={() => controller.close(snapshot.share.id)}>
      <FlatList
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
            Choose a draft. Nothing is sent automatically.
            </AppText>
            {snapshot.error ? (
              <AppText className="text-danger-foreground">{snapshot.error}</AppText>
            ) : null}
            {snapshot.busy ? (
              <ListActionRow label={snapshot.loadingDrafts ? "Loading saved drafts…" : "Attaching shared content…"} loading onPress={() => {}} />
            ) : snapshot.loadingDrafts ? (
              <ListActionRow label="Retry loading saved drafts" onPress={() => controller.reloadDrafts()} />
            ) : (
              <>
                {snapshot.retryAvailable ? (
                  <ListActionRow label="Retry import" onPress={() => void controller.retry()} />
                ) : null}
                <ListSection>
                  {snapshot.current &&
                  (!reserved || sameForkShareDestination(reserved, snapshot.current)) ? (
                    <ListActionRow
                      label="Current conversation"
                      description={snapshot.current.title}
                      onPress={() => void controller.choose(snapshot.current!)}
                    />
                  ) : null}
                  {!reserved ? (
                    <ListActionRow
                      label="New conversation"
                      description="Choose a project"
                      onPress={() => controller.newConversation()}
                    />
                  ) : null}
                </ListSection>
                {reserved ? (
                  <AppText textRole="footnote" className="text-foreground-muted">
                    This share is reserved for the conversation selected earlier.
                  </AppText>
                ) : null}
                <View className="flex-row">
                  <SearchField
                    inputRef={inputRef}
                    autoFocus={false}
                    accessibilityLabel="Find conversation"
                    clearAccessibilityLabel="Clear search"
                    placeholder="Find existing conversation"
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
            label={item.title || "Untitled conversation"}
                  description={`${item.projectName} · ${item.environmentName}`}
            onPress={() => void controller.choose(item)}
          />
        )}
        ListEmptyComponent={
          snapshot.busy ? undefined : (
            <AppText textRole="footnote" className="text-foreground-muted">
              No matching conversations. Connect to the server to load its conversations.
            </AppText>
          )
        }
        ListFooterComponent={snapshot.busy || snapshot.loadingDrafts ? undefined : (
          <ListSection>
            {recovery.merged ? (
              <ListActionRow label="Keep saved draft" description="Finish saving the content already added to this draft." onPress={() => void controller.keepDraft()} />
            ) : (
              <>
                {recovery.destination ? <ListActionRow label="Choose another conversation" onPress={() => void controller.changeDestination()} /> : null}
                <ListActionRow label="Discard share" tone="danger" onPress={() => void controller.discard()} />
              </>
            )}
          </ListSection>
        )}
      />
    </Sheet>
  );
}

export function ForkShareDestinationHost() {
  const controller = forkShareDestinations!;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!snapshot) return null;
  return snapshot.visible ? <DestinationSheet key={snapshot.share.id} snapshot={snapshot} /> : (
    <View className="absolute bottom-8 left-4 right-4 rounded-xl bg-grouped-card">
      <Pressable accessibilityRole="button" accessibilityLabel="Resume shared content import" onPress={() => controller.reopen()} className="min-h-14 justify-center p-4">
        <AppText>{snapshot.busy ? "Importing shared content…" : "Shared content waiting. Tap to continue"}</AppText>
      </Pressable>
    </View>
  );
}
