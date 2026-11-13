import type { ComponentProps } from "react";
import { workingSidebarFilterActive } from "@t3tools/client-runtime/state/working-sidebar-view";
import { Checkbox } from "../ui/checkbox";
import { MenuCheckboxItem, MenuSeparator } from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { useWorkingSidebarView } from "./useWorkingSidebarView";

export function WorkingOnlyFilter() {
  const { workingOnly, setWorkingOnly } = useWorkingSidebarView();
  return (
    <div className="my-1 border-y border-border px-2 py-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={workingOnly} onCheckedChange={(checked) => setWorkingOnly(checked)} />
        Working only
      </label>
    </div>
  );
}

export function WorkingFirstMenuItem() {
  const { workingFirst, setWorkingFirst } = useWorkingSidebarView();
  return (
    <>
      <MenuSeparator />
      <MenuCheckboxItem checked={workingFirst} onCheckedChange={setWorkingFirst}>
        Show Working above main list
      </MenuCheckboxItem>
    </>
  );
}

export function SidebarFilterButton({
  machineScoped,
  projectScoped,
  label,
  children,
  className,
  ...props
}: ComponentProps<typeof SidebarHeaderIconButton> & {
  readonly machineScoped: boolean;
  readonly projectScoped: boolean;
}) {
  const { workingOnly } = useWorkingSidebarView();
  const active = workingSidebarFilterActive(workingOnly, machineScoped, projectScoped);
  const description = `${label}${workingOnly ? " · Working only" : ""}`;
  return (
    <SidebarHeaderIconButton {...props} label={description} active={active} className={className}>
      {children}
      {active ? (
        <span
          aria-hidden
          data-testid="sidebar-filter-active"
          className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary ring-1 ring-sidebar"
        />
      ) : null}
    </SidebarHeaderIconButton>
  );
}

export function WorkingSectionDivider({ show }: { readonly show: boolean }) {
  return show ? (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-0.5 h-px bg-sidebar-foreground/25"
    />
  ) : null;
}
