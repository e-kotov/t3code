import { useIsFocused } from "@react-navigation/native";
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
  useEffect(() => {
    if (request) reconcileAssistantCitationRoute(request.id, environmentId, threadId, focused);
  }, [request, environmentId, threadId, focused]);
}
