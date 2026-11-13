import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { expect, it, vi } from "vite-plus/test";
import type { EnvironmentPresentation } from "../../state/environments";
import { render } from "../../../test/render";
import { SettingsPageContainer } from "./settingsLayout";
import { validateSettingsRouteSearch } from "./settingsScopeNavigation";
import { TargetedLocalMachineConnection } from "./TargetedLocalMachineConnection";
import "../../index.css";

const fixture = vi.hoisted(() => ({ environments: [] as EnvironmentPresentation[] }));
vi.mock(import("../../state/environments"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useEnvironments: () => ({ ...actual.useEnvironments(), environments: fixture.environments }),
  };
});

function ConnectionSettingsPage() {
  return (
    <SettingsPageContainer>
      <TargetedLocalMachineConnection />
    </SettingsPageContainer>
  );
}

it.each(["primary", "desktop-local"] as const)(
  "reveals an unavailable %s machine's connection status",
  async (kind) => {
    const environmentId = EnvironmentId.make("local-machine");
    fixture.environments = [
      {
        environmentId,
        label: "Local machine",
        displayUrl: null,
        relayManaged: false,
        entry: {
          target:
            kind === "primary"
              ? new PrimaryConnectionTarget({
                  environmentId,
                  label: "Local machine",
                  httpBaseUrl: "http://localhost",
                  wsBaseUrl: "ws://localhost",
                })
              : new BearerConnectionTarget({
                  environmentId,
                  label: "Local machine",
                  connectionId: "local:wsl",
                }),
          enabled: true,
          profile: Option.none(),
        },
        connection: { phase: "reconnecting", error: "Connection refused", traceId: null },
        serverConfig: null,
      },
    ];
    const root = createRootRoute();
    const connections = createRoute({
      getParentRoute: () => root,
      path: "/settings/connections",
      validateSearch: validateSettingsRouteSearch,
      component: ConnectionSettingsPage,
    });
    const router = createRouter({
      routeTree: root.addChildren([connections]),
      history: createMemoryHistory({
        initialEntries: [
          "/settings/connections?machine=local-machine#machine-connection-local-machine",
        ],
      }),
      disableGlobalCatchBoundary: true,
    });
    await router.load();
    await using screen = await render(<RouterProvider router={router} />, {
      // This flow needs the production settings query validation.
      router: false,
    });
    await expect.element(screen.getByText("Local machine", { exact: true })).toBeVisible();
    const target = screen.container.querySelector("#machine-connection-local-machine");
    await vi.waitFor(() => expect(document.activeElement).toBe(target));
    expect(target?.textContent).toContain("Local machine");
    expect(target?.textContent).toContain("Connection refused");
    expect(router.state.location.hash).toBe("");
  },
);
