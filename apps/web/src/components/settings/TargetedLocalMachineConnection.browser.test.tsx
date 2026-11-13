import { createMemoryHistory } from "@tanstack/react-router";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import type * as Context from "effect/Context";
import * as Option from "effect/Option";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import type { EnvironmentPresentation } from "../../state/environments";
import {
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import "../../index.css";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const fixture = vi.hoisted(() => ({ environments: [] as EnvironmentPresentation[] }));
vi.mock(import("../../state/environments"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useEnvironments: () => ({ ...actual.useEnvironments(), environments: fixture.environments }),
  };
});

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
    using _environment = installFakeEnvironment([threadWithHistory("local-settings", 1)]);
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const router = getRouter(
      createMemoryHistory({
        initialEntries: [
          "/settings/connections?machine=local-machine#machine-connection-local-machine",
        ],
      }),
    );
    await router.load();
    await using _screen = await render(<AppRoot router={router} />, {
      // AppRoot owns the production router and its settings search middleware.
      router: false,
    });
    expect(router.state.location.pathname).toBe("/settings/connections");
    expect(router.state.location.search.machine).toBe("local-machine");
    await expect.element(page.getByText("Local machine", { exact: true })).toBeVisible();
    const target = document.getElementById("machine-connection-local-machine");
    await vi.waitFor(() => expect(document.activeElement).toBe(target));
    expect(target?.textContent).toContain("Local machine");
    expect(target?.textContent).toContain("Connection refused");
    expect(router.state.location.hash).toBe("");
  },
);
