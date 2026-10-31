import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { ThreadDetailsUsageInput } from "./ThreadDetailsUsage";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ nativeId: "native-one", weekly: 1.25 }));
vi.mock("../../state/entities", () => ({
  useQuietThreadShell: () => ({ activeProviderThreadId: "same-provider-row" }),
  useQuietThreadProjection: () => ({ projection: {
    thread: { activeProviderThreadId: "same-provider-row" },
    providerThreads: [{ id: "same-provider-row", nativeThreadRef: { nativeId: state.nativeId } }],
  } }),
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/state/fork-thread-quota", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    createForkThreadQuotaAtoms: () =>
      Atom.family((_key: string) =>
        Atom.make(
          AsyncResult.success({
            status: "available" as const,
            checkedAt: "2026-10-31T12:00:00Z",
            dataAsOf: null,
            fiveHourPercent: null,
            weeklyPercent: state.weekly,
            balanceCredits: null,
          }),
        ),
      ),
  };
});

import { ForkThreadQuota } from "./ForkThreadQuota";

it("replaces the prior reading when a thread changes native task or Codex account", async () => {
  const environmentId = EnvironmentId.make("environment");
  const threadId = ThreadId.make("thread");
  const usage = (id: string): ThreadDetailsUsageInput =>
    ({
      providerInstanceId: ProviderInstanceId.make(id),
      providers: [
        { instanceId: id, driver: ProviderDriverKind.make("codex"), auth: { workspaceId: id } },
      ],
    }) as unknown as ThreadDetailsUsageInput;
  await using screen = await render(
    <ForkThreadQuota
      environmentId={environmentId}
      threadId={threadId}
      usage={usage("account-one")}
    />,
  );
  await expect.element(page.getByText("Weekly 1.25%", { exact: true })).toBeVisible();
  state.nativeId = "native-two";
  state.weekly = 2.5;
  await screen.rerender(
    <ForkThreadQuota
      environmentId={environmentId}
      threadId={threadId}
      usage={usage("account-one")}
    />,
  );
  await expect.element(page.getByText("Weekly 2.5%", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Weekly 1.25%", { exact: true })).not.toBeInTheDocument();
  state.weekly = 3.75;
  await screen.rerender(
    <ForkThreadQuota
      environmentId={environmentId}
      threadId={threadId}
      usage={usage("account-two")}
    />,
  );
  await expect.element(page.getByText("Weekly 3.75%", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Weekly 2.5%", { exact: true })).not.toBeInTheDocument();
});
