import type { LegendListRef } from "@legendapp/list/react-native";
import { useIsFocused } from "@react-navigation/native";
import { RunId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import * as Dialog from "../../components/ui/Dialog";
import {
  finishAssistantCitationNavigation,
  assistantCitationNavigationForScope,
  readAssistantCitationNavigation,
  subscribeAssistantCitationNavigation,
} from "../../lib/assistantCitationNavigation";
import { assistantCitationSourceStep } from "../../lib/assistantCitationMessage";
import type { ThreadFeedEntry } from "../../lib/threadActivity";
import type { ThreadFeedHistoryControls } from "./ThreadFeed";

export function useAssistantCitationSourceTarget(input: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly visible: ReadonlyArray<ThreadFeedEntry>;
  readonly history?: ThreadFeedHistoryControls;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly listKey: string;
  readonly topInset: number;
  readonly onManualNavigation: () => void;
  readonly onExpandTurn: (runId: RunId) => void;
}) {
  const pendingRequest = useSyncExternalStore(subscribeAssistantCitationNavigation, readAssistantCitationNavigation);
  const request = assistantCitationNavigationForScope(pendingRequest, input.environmentId, input.threadId);
  const focused = useIsFocused();
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [source, setSource] = useState<{ scope: string; rowId: string } | null>(null);
  const progress = useRef<{ id: number; pages: Set<string>; expanded: Set<string>; scrolling: boolean } | null>(null);
  const scope = JSON.stringify([input.environmentId, input.threadId]);
  const cancel = () => {
    if (request) finishAssistantCitationNavigation(request.id);
    setSource(null);
  };
  const navigate = useEffectEvent(() => {
    if (!request) return;
    if (!focused) {
      if (progress.current?.id === request.id) finishAssistantCitationNavigation(request.id);
      return;
    }
    if (progress.current?.id !== request.id) {
      progress.current = { id: request.id, pages: new Set(), expanded: new Set(), scrolling: false };
      setSource(null);
      input.onManualNavigation();
    }
    const current = progress.current;
    if (current.scrolling) return;
    const fail = (reason: string) => {
      finishAssistantCitationNavigation(request.id);
      Dialog.alert("Source response unavailable", `${reason}\n\nYour saved quote is unchanged.`);
    };
    const step = assistantCitationSourceStep({ citation: request.citation, feed: input.feed, visible: input.visible, history: input.history, requestedPages: current.pages });
    if (step.kind === "wait") return;
    if (step.kind === "unavailable") return fail(step.reason);
    if (step.kind === "load") {
      current.pages.add(step.page);
      input.history?.onLoadEarlier();
      return;
    }
    if (step.kind === "expand") {
      if (current.expanded.has(step.runId)) return fail("The cited response could not be expanded.");
      current.expanded.add(step.runId);
      input.onExpandTurn(RunId.make(step.runId));
      return;
    }
    if (loadedKey !== input.listKey || !input.listRef.current) return;
    current.scrolling = true;
    setSource({ scope, rowId: step.rowId });
    const list = input.listRef.current;
    void Promise.resolve()
      .then(() => {
        if (readAssistantCitationNavigation()?.id !== request.id) return;
        return list.scrollToIndex({ index: step.index, viewPosition: 0, viewOffset: input.topInset, animated: true });
      })
      .then(() => finishAssistantCitationNavigation(request.id))
      .catch(() => {
        if (readAssistantCitationNavigation()?.id === request.id) fail("Could not scroll to the cited response. Try again.");
      });
  });
  useEffect(() => { navigate(); }, [request, focused, input.feed, input.visible, input.history, input.listKey, loadedKey]);
  return {
    rowId: source?.scope === scope ? source.rowId : null,
    onLoad: () => setLoadedKey(input.listKey),
    cancel,
  };
}
