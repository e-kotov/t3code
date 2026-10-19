import type { AndroidHeaderAction } from "../../components/ui/AndroidScreenHeader";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useWorkspaceListNavigation } from "../workspace/useAndroidWorkspaceNavigation";

// The split view has no bottom navigation bar, so each sidebar list header links to the others.
export function useShowUtilitiesAction(): AndroidHeaderAction {
  const onPress = useWorkspaceListNavigation("commands");
  return { accessibilityLabel: "Show utilities", icon: "server.rack", onPress };
}

export function useUtilitiesSidebarExitActions(): ReadonlyArray<AndroidHeaderAction> {
  const showThreads = useWorkspaceListNavigation("threads");
  const showPullRequests = useWorkspaceListNavigation("pullRequests");
  return [
    { accessibilityLabel: "Show threads", icon: "text.bubble", onPress: showThreads },
    {
      accessibilityLabel: "Show pull requests",
      icon: PullRequestGlyph.pullRequest,
      onPress: showPullRequests,
    },
  ];
}
