import { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentPresentation } from "../../state/environments";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { SettingsPageContainer } from "./settingsLayout";
import { TargetedMachineConnectionRow } from "./TargetedMachineConnectionRow";
import "../../index.css";

vi.mock(import("./SavedEnvironmentRows"), () => ({
  SavedBackendListRow: ({ environment }: { environment: EnvironmentPresentation }) => (
    <div>{environment.label}: Reconnecting...</div>
  ),
}));

it("reveals and focuses the machine named by a connection-settings link", async () => {
  const gwdg = EnvironmentId.make("gwdg");
  const hub = EnvironmentId.make("hub");
  await using screen = await render(
    <SettingsPageContainer>
      {[gwdg, hub].map((environmentId) => (
        <TargetedMachineConnectionRow
          key={environmentId}
          environment={{ environmentId, label: environmentId } as EnvironmentPresentation}
          removingEnvironmentId={null}
          onSetEnabled={() => {}}
          onRemove={() => {}}
          onAddRoute={() => {}}
        />
      ))}
    </SettingsPageContainer>,
    { router: "/settings/connections?machine=hub#machine-connection-hub" },
  );
  const target = screen.container.querySelector("#machine-connection-hub");
  await vi.waitFor(() => expect(document.activeElement).toBe(target));
  expect(target?.textContent).toContain("hub: Reconnecting");
  expect(screen.container.querySelector("#machine-connection-gwdg")).not.toBe(
    document.activeElement,
  );
  expect(screen.router?.state.location.hash).toBe("");
});
