import type {
  resolveSelectedNavigationTab,
  selectedNavigationTab,
} from "../workspace/navigation-tab-order";

/**
 * The fork's Android Utilities section. It stays outside upstream's registered sections, so
 * it is not reorderable or hidable and upstream's section tests keep their exact lists.
 */
const UTILITIES_WORKSPACE_TAB = "commands";
export type UtilitiesWorkspaceTab = typeof UTILITIES_WORKSPACE_TAB;

/**
 * Upstream's hidden-section fallback, except that Utilities stays selected. Taking upstream's
 * resolver as an argument keeps each upstream call site a one-line change.
 */
export function keepUtilities(resolve: typeof resolveSelectedNavigationTab) {
  return (
    saved: Parameters<typeof resolve>[0],
    hidden: Parameters<typeof resolve>[1],
    selected: Parameters<typeof resolve>[2] | UtilitiesWorkspaceTab,
  ) => (selected === UTILITIES_WORKSPACE_TAB ? selected : resolve(saved, hidden, selected));
}

/** Upstream's highlighted navigation item, with Utilities highlighted unless Settings is open. */
export function highlightUtilities(select: typeof selectedNavigationTab) {
  return (
    saved: Parameters<typeof select>[0],
    selected: Parameters<typeof select>[1] | UtilitiesWorkspaceTab,
    settingsOpen: boolean,
    hidden?: Parameters<typeof select>[3],
    capacity?: number,
  ) => {
    if (selected !== UTILITIES_WORKSPACE_TAB) {
      return select(saved, selected, settingsOpen, hidden, capacity);
    }
    return settingsOpen ? "settings" : selected;
  };
}

/**
 * Tab count for the Android One UI floating navigation bar.
 * In upstream, floating tabs include the enabled sections plus 1 (the fixed Settings tab).
 * In this fork, the bar also includes Utilities ("commands"), so the count is enabled + 2.
 */
export function floatingNavigationTabCount(enabledCount: number): number {
  return enabledCount + 2;
}
