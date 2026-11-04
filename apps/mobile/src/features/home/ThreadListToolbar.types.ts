import type { MenuAction } from "@react-native-menu/menu";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ConversationListControls } from "./conversationListOptions";

export interface ThreadListToolbarProps {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly filterActions: MenuAction[];
  readonly filterCustomized: boolean;
  readonly onFilterSelect: (id: string) => void;
  readonly onOpenEnvironments: () => void;
  readonly onRequestVisibility?: () => void;
  readonly conversationList?: ConversationListControls;
  readonly cacheWarmingEnvironmentId?: EnvironmentId | null;
}
