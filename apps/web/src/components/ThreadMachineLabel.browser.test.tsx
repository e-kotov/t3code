import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ThreadId, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { ThreadContextChip } from "./ThreadContextChip";

type MachineEnvironment = {
  label: string;
  serverConfig: Parameters<typeof resolveEnvironmentMachineKind>[0];
} | null;

const state = vi.hoisted(() => ({
  environment: undefined as Atom.Writable<MachineEnvironment> | undefined,
}));

vi.mock("../state/environments", () => ({
  useEnvironment: () => {
    if (!state.environment) throw new Error("Environment not configured");
    return useAtomValue(state.environment);
  },
}));
vi.mock("../state/entities", () => ({
  useThreadShell: () => null,
  useProject: () => null,
}));

function setup() {
  const environment = Atom.make<MachineEnvironment>({
    label: "Raven",
    serverConfig: null,
  });
  state.environment = environment;
  return { environment, registry: AtomRegistry.make() };
}

it("keeps a thread's destination and copied reference while its machine is renamed or removed", async () => {
  const { environment, registry } = setup();
  const environmentId = EnvironmentId.make("3f2a1b4c-9d11-4f44-8e00-4c2e3355b7d9");
  const threadId = ThreadId.make("routing-thread");
  const copyMarkdown = `[Routing](t3-thread://v2/${environmentId}/${threadId})`;
  try {
    await using screen = await render(
      <RegistryContext value={registry}>
        <ThreadContextChip
          record={{ environmentId, threadId, title: "Routing" }}
          copyMarkdown={copyMarkdown}
        />
      </RegistryContext>,
    );
    const link = screen.getByRole("link", { name: "Raven · Routing" });
    await expect.element(link).toHaveAttribute("href", `/${environmentId}/${threadId}`);
    await expect.element(link).toHaveAttribute("data-markdown-copy", copyMarkdown);
    await expect
      .element(link.element().querySelector<SVGSVGElement>(".lucide-server"))
      .toBeVisible();

    registry.set(environment, {
      label: "Raven HPC",
      serverConfig: {
        environment: { platform: { os: "linux", arch: "x64", machine: "server" } },
        settings: { environmentIcon: "laptop" },
      },
    });
    const renamed = screen.getByRole("link", { name: "Raven HPC · Routing" });
    await expect.element(renamed).toBeVisible();
    await expect
      .element(renamed.element().querySelector<SVGSVGElement>(".lucide-laptop"))
      .toBeVisible();

    const longName = "Raven research workstation with a machine name wider than the inline label";
    registry.set(environment, { label: longName, serverConfig: null });
    const longLink = screen.getByRole("link", { name: `${longName} · Routing` });
    await expect.element(longLink).toBeVisible();
    await userEvent.hover(longLink);
    const tooltip = page.getByRole("tooltip");
    await expect.element(tooltip).toHaveTextContent(longName);
    await userEvent.unhover(longLink);
    await expect.element(tooltip).not.toBeInTheDocument();

    registry.set(environment, null);
    const unknown = screen.getByRole("link", { name: "Unknown machine · Routing" });
    await expect.element(unknown).toHaveAttribute("href", `/${environmentId}/${threadId}`);
    await expect.element(unknown).not.toHaveTextContent(environmentId);
    await expect.element(unknown).toHaveAttribute("data-markdown-copy", copyMarkdown);
    await expect
      .element(unknown.element().querySelector<SVGSVGElement>(".lucide-circle-dashed"))
      .toBeVisible();
    await userEvent.hover(unknown);
    await expect.element(tooltip).toHaveTextContent("Unknown machine");
    await expect.element(tooltip).toHaveTextContent(environmentId);
  } finally {
    registry.dispose();
  }
});
