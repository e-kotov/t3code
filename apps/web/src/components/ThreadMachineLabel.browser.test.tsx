import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ThreadId, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

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
  const environmentId = EnvironmentId.make("raven-environment");
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
    await expect.element(link.element().querySelector<SVGSVGElement>(".lucide-server")).toBeVisible();

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

    registry.set(environment, null);
    await expect
      .element(screen.getByRole("link", { name: "raven-environment · Routing" }))
      .toHaveAttribute("href", `/${environmentId}/${threadId}`);
  } finally {
    registry.dispose();
  }
});
