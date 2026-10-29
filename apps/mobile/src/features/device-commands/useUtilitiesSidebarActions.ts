import type { AndroidHeaderAction } from "../../components/ui/AndroidScreenHeader";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useSelectWorkspaceTab } from "../workspace/useSelectWorkspaceTab";

// The split view has no bottom navigation bar, so each sidebar list header links to the others.
export function useShowUtilitiesAction(): AndroidHeaderAction {
  const selectTab = useSelectWorkspaceTab();
  const onPress = () => selectTab("commands");
  return { accessibilityLabel: "Show utilities", icon: "server.rack", onPress };
}

export function useUtilitiesSidebarExitActions(): ReadonlyArray<AndroidHeaderAction> {
  const selectTab = useSelectWorkspaceTab();
  const showThreads = () => selectTab("threads");
  const showPullRequests = () => selectTab("pullRequests");
  return [
    { accessibilityLabel: "Show threads", icon: "text.bubble", onPress: showThreads },
    {
      accessibilityLabel: "Show pull requests",
      icon: PullRequestGlyph.pullRequest,
      onPress: showPullRequests,
    },
  ];
}
