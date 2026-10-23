import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import type { ThreadCachePolicy } from "@t3tools/shared/threadCachePolicy";
import { render } from "../../test/render";
import { ThreadCachePolicyMenu } from "./ThreadCachePolicyControl";

function PolicyPicker({ driver = "claudeAgent" }: { readonly driver?: string }) {
  const [policy, setPolicy] = useState<ThreadCachePolicy>("default");
  return <ThreadCachePolicyMenu policy={policy} driver={driver} canWrite onChange={setPolicy} />;
}

it("lets a user switch between warming, compaction, Off and inherited settings", async () => {
  await using screen = await render(<PolicyPicker />);
  for (const label of ["Keep warm", "Compact before expiry", "Off", "Default"]) {
    await screen.getByRole("button", { name: /^Idle cache policy:/ }).click();
    await screen.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }).click();
    await expect
      .element(screen.getByRole("button", { name: `Idle cache policy: ${label}` }))
      .toBeVisible();
    await screen.getByRole("button", { name: `Idle cache policy: ${label}` }).click();
    await expect
      .element(screen.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }))
      .toBeChecked();
    await screen.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }).click();
  }
});

it("offers only supported actions on Codex and opens the same policy menu with a right click", async () => {
  await using screen = await render(<PolicyPicker driver="codex" />);
  await screen
    .getByRole("button", { name: "Idle cache policy: Default" })
    .click({ button: "right" });
  await expect.element(screen.getByRole("menuitemradio", { name: /^Keep warm/ })).toBeVisible();
  await expect
    .element(screen.getByRole("menuitemradio", { name: /^Compact before expiry/ }))
    .not.toBeInTheDocument();
});

it("does not change settings on a connection without settings permission", async () => {
  const change = vi.fn();
  await using screen = await render(
    <ThreadCachePolicyMenu policy="off" driver="claudeAgent" canWrite={false} onChange={change} />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Idle cache policy: Off" }))
    .toBeDisabled();
  expect(change).not.toHaveBeenCalled();
});
