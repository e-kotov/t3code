import { useIsFocused, useRoute } from "@react-navigation/native";
import { useEffect, useSyncExternalStore } from "react";
import {
  readAssistantCitationNavigation,
  reconcileAssistantCitationRoute,
  subscribeAssistantCitationNavigation,
} from "../../lib/assistantCitationNavigation";

export function useAssistantCitationRoute(environmentId: string | null, threadId: string | null) {
  const request = useSyncExternalStore(
    subscribeAssistantCitationNavigation,
    readAssistantCitationNavigation,
  );
  const focused = useIsFocused();
  const routeKey = useRoute().key;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reconcile citation navigation with the focused native route.
  useEffect(() => {
    if (request)
      reconcileAssistantCitationRoute(request.id, environmentId, threadId, focused, routeKey);
  }, [request, environmentId, threadId, focused, routeKey]);
}
