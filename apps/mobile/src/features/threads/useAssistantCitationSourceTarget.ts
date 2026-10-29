import { AssistantCitationSynchronization } from "./AssistantCitationSynchronization";
import {
  createAssistantCitationPassageActivation,
  type AssistantCitationPassageLocation,
} from "../../lib/assistantCitationPassage";
import type { LegendListRef } from "@legendapp/list/react-native";
import { useIsFocused } from "@react-navigation/native";
import { RunId } from "@t3tools/contracts";
import {
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import * as Dialog from "../../components/ui/Dialog";
import {
  finishAssistantCitationNavigation,
  assistantCitationNavigationForScope,
  readAssistantCitationNavigation,
  subscribeAssistantCitationNavigation,
} from "../../lib/assistantCitationNavigation";
import { assistantCitationSourceStep } from "../../lib/assistantCitationMessage";
import {
  deriveThreadFeedRunFolds,
  failedFeedRunIds,
  settleSupersededReasoning,
  type ThreadFeedEntry,
  type ThreadFeedLatestRun,
} from "../../lib/threadActivity";
import type { AssistantCitationPassageTarget } from "./AssistantCitationPassage";
import type { ThreadFeedHistoryControls } from "./ThreadFeed";
import type { ThreadContentPresentation } from "./threadContentPresentation";

export function useAssistantCitationSourceTarget(input: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly contentPresentation: ThreadContentPresentation;
  readonly latestRun: ThreadFeedLatestRun | null;
  readonly runlessWorkActive: boolean;
  readonly activeWorkStartedAt: string | null;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly visible: ReadonlyArray<{ readonly id: string }>;
  readonly history?: ThreadFeedHistoryControls;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly listKey: string;
  readonly topInset: number;
  readonly onManualNavigation: () => void;
  readonly onExpandTurn: (runId: RunId) => void;
}) {
  const synchronization = useContext(AssistantCitationSynchronization);
  const passageActivation = useRef(createAssistantCitationPassageActivation());
  const [historyCompletion, setHistoryCompletion] = useState(0);
  const pendingRequest = useSyncExternalStore(
    subscribeAssistantCitationNavigation,
    readAssistantCitationNavigation,
  );
  const request = assistantCitationNavigationForScope(
    pendingRequest,
    input.environmentId,
    input.threadId,
  );
  const focused = useIsFocused();
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [source, setSource] = useState<{
    scope: string;
    rowId: string;
    passage: AssistantCitationPassageTarget | null;
  } | null>(null);
  const progress = useRef<{
    id: number;
    pages: Set<string>;
    completedPages: Set<string>;
    expanded: Set<string>;
    scrolling: boolean;
  } | null>(null);
  const scope = JSON.stringify([input.environmentId, input.threadId]);
  const cancel = () => {
    passageActivation.current.cancel();
    if (request) finishAssistantCitationNavigation(request.id);
    setSource(null);
  };
  const navigate = useEffectEvent(() => {
    if (!focused) {
      passageActivation.current.cancel();
      setSource(null);
      if (request && progress.current?.id === request.id)
        finishAssistantCitationNavigation(request.id);
      return;
    }
    if (!request) return;
    if (progress.current?.id !== request.id) {
      passageActivation.current.cancel();
      progress.current = {
        id: request.id,
        pages: new Set(),
        completedPages: new Set(),
        expanded: new Set(),
        scrolling: false,
      };
      setSource(null);
      input.onManualNavigation();
    }
    const current = progress.current;
    if (current.scrolling) return;
    const fail = (reason: string) => {
      finishAssistantCitationNavigation(request.id);
      Dialog.alert("Source response unavailable", `${reason}\n\nYour saved quote is unchanged.`);
    };
    const step = assistantCitationSourceStep({
      presentation: input.contentPresentation,
      synchronization,
      foldRunId: (entryId) => {
        const retained = input.feed.filter(
          (entry) =>
            entry.type !== "run-fold" && entry.type !== "work-toggle" && entry.type !== "thinking",
        );
        const sourceFeed = retained.map((entry, index) =>
          settleSupersededReasoning(entry, index === retained.length - 1),
        );
        const isWorking =
          input.activeWorkStartedAt !== null && input.latestRun?.status !== "preparing";
        const folds = deriveThreadFeedRunFolds(
          sourceFeed,
          input.latestRun,
          isWorking && input.runlessWorkActive,
          failedFeedRunIds(sourceFeed, input.latestRun),
        );
        for (const fold of folds.values()) {
          if (fold.hiddenEntryIds.has(entryId)) return fold.runId;
        }
        return null;
      },
      citation: request.citation,
      feed: input.feed,
      visible: input.visible,
      history: input.history,
      requestedPages: current.pages,
      completedPages: current.completedPages,
    });
    if (step.kind === "wait") return;
    if (step.kind === "unavailable") return fail(step.reason);
    if (step.kind === "load") {
      current.pages.add(step.page);
      const loading = input.history?.onLoadEarlier(request.citation.messageId);
      if (!loading) return fail("Could not load the cited response. Try again.");
      void loading
        .then((result) => {
          if (readAssistantCitationNavigation()?.id !== request.id) return;
          if (result._tag === "error") return fail(result.message);
          if (result._tag === "busy") {
            current.pages.delete(step.page);
            return;
          }
          current.completedPages.add(step.page);
          setHistoryCompletion((revision) => revision + 1);
        })
        .catch(() => {
          if (readAssistantCitationNavigation()?.id === request.id)
            fail("Could not load the cited response. Try again.");
        });
      return;
    }
    if (step.kind === "expand") {
      if (current.expanded.has(step.runId))
        return fail("The cited response could not be expanded.");
      current.expanded.add(step.runId);
      input.onExpandTurn(RunId.make(step.runId));
      return;
    }
    if (loadedKey !== input.listKey || !input.listRef.current) return;
    current.scrolling = true;
    setSource({ scope, rowId: step.rowId, passage: null });
    const list = input.listRef.current;
    void Promise.resolve()
      .then(() => {
        if (readAssistantCitationNavigation()?.id !== request.id) return;
        return list.scrollToIndex({
          index: step.index,
          viewPosition: 0,
          viewOffset: input.topInset,
          animated: true,
        });
      })
      .then(() => {
        if (readAssistantCitationNavigation()?.id !== request.id) return;
        passageActivation.current.begin(request.id);
        setSource({
          scope,
          rowId: step.rowId,
          passage: {
            requestId: request.id,
            rowId: step.rowId,
            citation: request.citation,
            topInset: input.topInset,
          },
        });
        finishAssistantCitationNavigation(request.id);
      })
      .catch(() => {
        if (readAssistantCitationNavigation()?.id === request.id)
          fail("Could not scroll to the cited response. Try again.");
      });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Navigate to the requested citation after its source history becomes available.
  useEffect(() => {
    navigate();
  }, [
    request,
    focused,
    input.feed,
    input.visible,
    input.history?.cursor,
    input.history?.hasMoreHistory,
    input.history?.loading,
    input.history?.error,
    input.listKey,
    input.contentPresentation,
    input.latestRun,
    input.runlessWorkActive,
    input.activeWorkStartedAt,
    synchronization,
    historyCompletion,
    loadedKey,
  ]);
  return {
    rowId: source?.scope === scope ? source.rowId : null,
    passage: source?.scope === scope ? source.passage : null,
    onPassageLocated: (location: AssistantCitationPassageLocation) => {
      if (!focused) return;
      const delta = passageActivation.current.consume(location);
      const list = input.listRef.current;
      if (delta === null || !list) return;
      void list.scrollToOffset({
        offset: Math.max(0, list.getState().scroll + delta),
        animated: true,
      });
    },
    onLoad: () => setLoadedKey(input.listKey),
    cancel,
  };
}
