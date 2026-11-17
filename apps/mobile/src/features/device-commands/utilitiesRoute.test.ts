import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";
import { utilitiesOpenAction, UTILITIES_PRESENTATION, UTILITIES_ROUTE } from "./utilitiesRoute";
import {
  isPresentedRoute,
  projectStackPresentation,
  projectWorkspaceStack,
} from "../../native/workspace-stack-projection";
import { workspaceDetailRouter } from "../layout/workspace/workspace-detail-selection";
import { registerPresentedRoutes, workspaceRoutesOf } from "../layout/workspace-overlay-routes";

const require = NodeModule.createRequire(import.meta.url);
const native = NodeModule.createRequire(require.resolve("@react-navigation/native/package.json"));
const core = NodeModule.createRequire(native.resolve("@react-navigation/core/package.json"));
const { StackRouter, StackActions } = core("@react-navigation/routers") as Pick<
  typeof import("@react-navigation/native"),
  "StackRouter" | "StackActions"
>;
const base = StackRouter({});
const router = { ...base, ...workspaceDetailRouter(base) };
const options = {
  routeNames: [
    "Home",
    "Thread",
    "PullRequest",
    "Issue",
    "Settings",
    "SettingsAppearance",
    UTILITIES_ROUTE,
  ],
  routeParamList: {},
  routeGetIdList: {},
};
type State = ReturnType<typeof base.getInitialState>;
function apply(state: State, action: Parameters<typeof base.getStateForAction>[1]) {
  const next = router.getStateForAction(state, action, options);
  if (!next) throw new Error(`Rejected ${action.type}`);
  return base.getRehydratedState(next, options);
}

describe("Utilities tool route", () => {
  it.each(
    [
      [],
      ["Thread"],
      ["PullRequest"],
      ["Issue"],
      ["Settings"],
      ["Settings", "SettingsAppearance"],
    ].map((names) => ({ names })),
  )("returns to the exact history from %j after repeated opens and Back", ({ names }) => {
    let before = base.getInitialState(options);
    for (const name of names) before = apply(before, StackActions.push(name, { saved: name }));
    for (let attempt = 0; attempt < 3; attempt++) {
      const action = utilitiesOpenAction(before)!;
      expect(action.target).toBe(before.key);
      const opened = apply(before, action);
      expect(opened.routes.slice(0, -1)).toEqual(before.routes);
      expect(opened.routes.at(-1)?.name).toBe(UTILITIES_ROUTE);
      expect(utilitiesOpenAction(opened)).toBeNull();
      const closed = apply(opened, StackActions.pop());
      expect(closed.routes).toEqual(before.routes);
      expect(closed.index).toBe(before.index);
      before = closed;
    }
  });

  it("keeps the same presenting history beneath the full-screen route across split projections", () => {
    const before = apply(
      base.getInitialState(options),
      StackActions.push("Issue", { issueKey: "42" }),
    );
    const opened = apply(before, utilitiesOpenAction(before)!);
    expect(isPresentedRoute(UTILITIES_PRESENTATION)).toBe(true);
    registerPresentedRoutes([UTILITIES_ROUTE]);
    try {
      const isOverlay = (route: { name: string }) =>
        route.name === UTILITIES_ROUTE && isPresentedRoute(UTILITIES_PRESENTATION);
      const compact = projectStackPresentation(opened, isOverlay);
      const columns = projectWorkspaceStack(opened, isOverlay);
      expect(compact.workspace).toEqual(before.routes);
      expect(columns.primary).toEqual(before.routes[0]);
      expect(columns.detail).toEqual(before.routes.slice(1));
      expect(columns.overlays).toEqual(compact.overlays);
      expect(workspaceRoutesOf(opened.routes)).toEqual(compact);
      expect(apply(opened, StackActions.pop()).routes).toEqual(before.routes);
    } finally {
      registerPresentedRoutes([]);
    }
  });
});

import { utilitiesLayout } from "./utilitiesLayout";

it("adapts to width and text size while keeping controls on one side of an Android hinge", () => {
  const insets = { left: 24, right: 16 };
  expect(utilitiesLayout(400, 1, insets, null)).toEqual({ ...insets, wide: false });
  expect(utilitiesLayout(1200, 1, insets, null)).toEqual({ ...insets, wide: true });
  expect(utilitiesLayout(1200, 2, insets, null)).toEqual({ ...insets, wide: false });
  expect(utilitiesLayout(1200, 1, insets, { x: 580, width: 40 })).toEqual({
    left: 620,
    right: 16,
    wide: false,
  });
  expect(utilitiesLayout(1200, 1, insets, { x: 800, width: 0 })).toEqual({
    left: 24,
    right: 400,
    wide: false,
  });
  expect(utilitiesLayout(800, 1, insets, null)).toEqual({ ...insets, wide: false });
});
