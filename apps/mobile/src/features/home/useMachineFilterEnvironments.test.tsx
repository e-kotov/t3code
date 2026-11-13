import {
  BearerConnectionTarget,
  type EnvironmentPresentation,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { currentMenuParent } from "../../components/ui/liveMenuActionPath";
import { menuActionsFromAppBarItems } from "../../components/ui/menuActionItems";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";
import { useMachineFilterEnvironments } from "./useMachineFilterEnvironments";

const fixture = vi.hoisted(() => ({
  presentations: new Map<EnvironmentId, EnvironmentPresentation>(),
  listeners: new Set<() => void>(),
  activityListeners: new Set<() => void>(),
  active: true,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () =>
    useSyncExternalStore(
      (listener) => {
        fixture.listeners.add(listener);
        return () => {
          fixture.listeners.delete(listener);
        };
      },
      () => fixture.presentations,
    ),
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return fixture.active ? "active" : "background";
    },
    addEventListener: (_event: string, listener: () => void) => {
      fixture.activityListeners.add(listener);
      return { remove: () => fixture.activityListeners.delete(listener) };
    },
  },
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({
    themeVariables: {
      "--color-warning-foreground": "#f59e0b",
      "--color-danger-foreground": "#dc2626",
      "--color-icon-muted": "#737373",
    },
  }),
}));

const GWDG = EnvironmentId.make("gwdg");
const environments = [{ environmentId: GWDG, label: "GWDG", nonSettledCount: 26 }];
function Harness() {
  const presented = useMachineFilterEnvironments(environments);
  const actions = menuActionsFromAppBarItems(
    buildHomeListFilterMenuItems({
      environments: presented,
      projects: [],
      selectedEnvironmentId: GWDG,
      selectedProjectKey: null,
      onEnvironmentChange: () => {},
      onProjectChange: () => {},
    }),
  );
  const [path, setPath] = useState<readonly (typeof actions)[number][]>([]);
  const parent = currentMenuParent(actions, path);
  return (
    <>
      <button onClick={() => setPath([actions[0]!])}>Environment</button>
      {parent?.subactions?.map((action) => (
        <div
          key={action.id}
          data-id={action.id}
          data-icon={action.image}
          data-color={typeof action.imageColor === "string" ? action.imageColor : undefined}
        >
          {action.title} {action.subtitle}
        </div>
      ))}
    </>
  );
}
function setPhase(phase: EnvironmentConnectionPhase) {
  const current = fixture.presentations.get(GWDG)!;
  fixture.presentations = new Map([
    [GWDG, { ...current, connection: { ...current.connection, phase } }],
  ]);
  for (const listener of fixture.listeners) listener();
}
function setup() {
  fixture.active = true;
  fixture.listeners.clear();
  fixture.activityListeners.clear();
  fixture.presentations = new Map([
    [
      GWDG,
      {
        entry: {
          target: new BearerConnectionTarget({
            environmentId: GWDG,
            label: "GWDG",
            connectionId: "gwdg",
          }),
          enabled: true,
          profile: Option.none(),
        },
        connection: { phase: "connected", error: null, traceId: null },
        serverConfig: {
          slurmJobStatus: {
            jobId: "16627419",
            state: "running",
            remainingSeconds: 5400,
            observedAt: 0,
            serverNow: 0,
          },
        },
      } as EnvironmentPresentation,
    ],
  ]);
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Harness />));
  act(() => host.querySelector("button")!.click());
  return {
    host,
    row: () => host.querySelector<HTMLElement>('[data-id="environment:gwdg"]')!,
    [Symbol.dispose]() {
      act(() => root.unmount());
      globals.IS_REACT_ACT_ENVIRONMENT = previous;
    },
  };
}

it("updates an open filter's Slurm time and status through disconnect and recovery", () => {
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  using screen = setup();
  expect(screen.row().textContent).toContain("GWDG (26) · 1h30m");
  expect(screen.row().getAttribute("data-icon")).toBeNull();
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.row().textContent).toContain("1h29m");
  for (const phase of [
    "connecting",
    "reconnecting",
    "error",
    "offline",
    "available",
    "unsupported",
    "connected",
  ] as const) {
    act(() => setPhase(phase));
    if (phase === "connected") {
      expect(screen.row().getAttribute("data-icon")).toBeNull();
      expect(screen.row().textContent).toContain("1h29m");
    } else {
      expect(screen.row().getAttribute("data-icon")).toBe("circle.fill");
      expect(screen.row().textContent).toContain("time ?");
      expect(screen.row().getAttribute("data-color")).toBe(
        phase === "connecting" || phase === "reconnecting"
          ? "#f59e0b"
          : phase === "error" || phase === "offline"
            ? "#dc2626"
            : "#737373",
      );
    }
  }
});

it("marks stale Slurm data unknown and stops its countdown timer in the background", () => {
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  using screen = setup();
  act(() => vi.advanceTimersByTime(300_000));
  expect(screen.row().textContent).toContain("time ?");
  act(() => {
    fixture.active = false;
    for (const listener of fixture.activityListeners) listener();
  });
  expect(vi.getTimerCount()).toBe(0);
  act(() => {
    fixture.active = true;
    for (const listener of fixture.activityListeners) listener();
  });
  expect(vi.getTimerCount()).toBe(1);
});
