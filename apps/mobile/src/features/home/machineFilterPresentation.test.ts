import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { menuActionsFromAppBarItems, findAppBarMenuItem } from "../../components/ui/menuActionItems";
import { currentMenuParent } from "../../components/ui/liveMenuActionPath";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";
import {
  machineFilterActionId,
  machineFilterEnvironmentId,
  nativeMachineFilterOptionPresentation,
} from "./machineFilterPresentation";

it("preserves filter counts and selection while exposing status and Slurm time to both menus", () => {
  const environmentId = EnvironmentId.make("gwdg");
  const environment = {
    environmentId,
    label: "GWDG",
    nonSettledCount: 26,
    slurmTimeRemaining: "time ?",
    filterConnectionStatus: { label: "GWDG is reconnecting", phase: "reconnecting" as const, color: "#f59e0b" },
  };
  const onEnvironmentChange = vi.fn();
  const items = buildHomeListFilterMenuItems({
    environments: [environment],
    projects: [],
    selectedEnvironmentId: environmentId,
    selectedProjectKey: null,
    onEnvironmentChange,
    onProjectChange: () => {},
  });
  const row = menuActionsFromAppBarItems(items)[0]?.subactions?.[1];
  expect(row).toMatchObject({
    title: "GWDG (26) · time ?",
    subtitle: "GWDG is reconnecting · 26 active",
    image: "circle.fill",
    imageColor: "#f59e0b",
    state: "on",
  });
  expect(machineFilterEnvironmentId(row!)).toBe(environmentId);
  findAppBarMenuItem(items, `environment:${environmentId}`)?.onPress();
  expect(onEnvironmentChange).toHaveBeenCalledExactlyOnceWith(environmentId);
  const native = nativeMachineFilterOptionPresentation(environment);
  expect(native).toMatchObject({ title: row?.title, subtitle: row?.subtitle, image: "circle.fill", imageColor: "#f59e0b" });
  expect(machineFilterEnvironmentId({ ...native, id: machineFilterActionId(environmentId) })).toBe(environmentId);
  expect(machineFilterEnvironmentId({ id: "project:gwdg", image: "circle.fill" })).toBeUndefined();
  expect(machineFilterEnvironmentId({ id: "environment:all", image: "circle.fill" })).toBeUndefined();
});

it("resolves an open submenu against current actions rather than frozen machine status", () => {
  const opened = { id: "environment", title: "Environment", subactions: [{ id: "environment:gwdg", title: "GWDG · 1h30m" }] };
  const refreshed = { ...opened, subactions: [{ id: "environment:gwdg", title: "GWDG · time ?", subtitle: "GWDG is reconnecting" }] };
  expect(currentMenuParent([refreshed], [opened])).toBe(refreshed);
  expect(currentMenuParent([], [opened])).toBeNull();
});
