import { ChevronDownIcon, FolderIcon, SquarePenIcon } from "lucide-react";
import { memo } from "react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";

import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import type { SidebarListItem } from "../Sidebar.logic";

export const SidebarMachineProjectFolderHeader = memo(
  function SidebarMachineProjectFolderHeader(props: {
    readonly item: Extract<SidebarListItem, { kind: "marker" }>;
    readonly project?: EnvironmentProject | null | undefined;
    readonly projectDisplayName?: string | null | undefined;
    readonly collapsed: boolean;
    readonly threadCount: number;
    readonly onToggle: () => void;
    readonly onNewThread?: (() => void) | undefined;
  }) {
    const { project, projectDisplayName, collapsed, threadCount, onToggle, onNewThread } = props;
    const displayName = projectDisplayName ?? project?.title ?? "No project";

    return (
      <li
        data-testid="sidebar-machine-project-folder"
        className="group/project-folder relative ml-2 mt-1.5 list-none first:mt-0"
      >
        <button
          type="button"
          data-sidebar-row={props.item.key}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-(--control-radius) px-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground/80 transition-transform",
              collapsed && "-rotate-90",
            )}
          />
          {project ? (
            <ProjectFavicon project={project} className="size-3.5 shrink-0" />
          ) : (
            <FolderIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground/80" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground/85">
            {displayName}
          </span>
          {threadCount > 0 ? (
            <span className="shrink-0 text-3xs tabular-nums text-sidebar-muted-foreground/70">
              {threadCount}
            </span>
          ) : null}
        </button>
        {onNewThread ? (
          <span className="absolute inset-y-0 right-2 flex items-center opacity-0 focus-within:opacity-100 group-hover/project-folder:opacity-100">
            <Button
              size="icon-xs"
              variant="ghost-muted"
              className="size-5"
              aria-label={`New thread in ${displayName}`}
              onClick={(e) => {
                e.stopPropagation();
                onNewThread();
              }}
            >
              <SquarePenIcon className="size-3" aria-hidden />
            </Button>
          </span>
        ) : null}
      </li>
    );
  },
);
