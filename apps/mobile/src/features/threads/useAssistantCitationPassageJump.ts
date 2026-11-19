import type { AssistantCitation } from "@t3tools/contracts";
import { StackActions, useNavigation } from "@react-navigation/native";
import { Platform } from "react-native";
import { requestAssistantCitationNavigation } from "../../lib/assistantCitationNavigation";

/** The exact passage navigator belongs to the full thread route, not a preview inspector. */
export function useAssistantCitationPassageJump() {
  const navigation = useNavigation();
  return (citation: AssistantCitation): boolean => {
    if (Platform.OS !== "android") return false;
    const target = {
      environmentId: String(citation.environmentId),
      threadId: String(citation.threadId),
    };
    const state = navigation.getState();
    const current = state?.routes[state.index];
    const params = current?.params as ReactNavigation.RootParamList["Thread"] | undefined;
    requestAssistantCitationNavigation(citation);
    if (
      current?.name !== "Thread" ||
      params?.environmentId !== target.environmentId ||
      params?.threadId !== target.threadId
    ) {
      navigation.dispatch(StackActions.push("Thread", target));
    }
    return true;
  };
}
