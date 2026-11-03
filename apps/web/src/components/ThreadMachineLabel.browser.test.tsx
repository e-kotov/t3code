import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ThreadId, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { ThreadContextChip } from "./ThreadContextChip";

const state = vi.hoisted(() => ({
  environment: undefined as Atom.Writable<{
    label: string;
    serverConfig: Parameters<typeof resolveEnvironmentMachineKind>[0];
  } | null> | undefined,
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

it("keeps a thread's destination and copied reference while its machine is renamed or removed", async () => {
  const environmentId = EnvironmentId.make("raven-environment");
  const threadId = ThreadId.make("routing-thread");
  const copyMarkdown = `[Routing](t3-thread://v2/${environmentId}/${threadId})`;
  state.environment = Atom.make<{
    label: string;
    serverConfig: Parameters<typeof resolveEnvironmentMachineKind>[0];
  } | null>({
    label: "Raven",
    serverConfig: null,
  });
  const registry = AtomRegistry.make();
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
    await expect.element(link.element().querySelector(".lucide-server")!).toBeVisible();

    registry.set(state.environment, {
      label: "Raven HPC",
      serverConfig: {
        environment: { platform: { os: "linux", arch: "x64", machine: "server" } },
        settings: { environmentIcon: "laptop" },
      },
    });
    const renamed = screen.getByRole("link", { name: "Raven HPC · Routing" });
    await expect.element(renamed).toBeVisible();
    await expect.element(renamed.element().querySelector(".lucide-laptop")!).toBeVisible();

    registry.set(state.environment, null);
    await expect
      .element(screen.getByRole("link", { name: "raven-environment · Routing" }))
      .toHaveAttribute("href", `/${environmentId}/${threadId}`);
  } finally {
    registry.dispose();
  }
});
