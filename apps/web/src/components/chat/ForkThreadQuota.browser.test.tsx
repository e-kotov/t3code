import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { ThreadDetailsUsageInput } from "./ThreadDetailsUsage";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({
  nativeId: "native-one",
  weekly: 1.25,
  listeners: new Set<() => void>(),
  projectionReads: 0,
  quotaRequests: 0,
}));
vi.mock("../../state/entities", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useQuietThreadShell: () => ({ activeProviderThreadId: "same-provider-row" }),
    useQuietThreadProjection: () => {
      state.projectionReads++;
      const nativeId = useSyncExternalStore(
        (notify) => {
          state.listeners.add(notify);
          return () => {
            state.listeners.delete(notify);
          };
        },
        () => state.nativeId,
      );
      return {
        projection: {
          thread: { activeProviderThreadId: "same-provider-row" },
          providerThreads: [{ id: "same-provider-row", nativeThreadRef: { nativeId } }],
        },
      };
    },
  };
});
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/state/fork-thread-quota", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    createForkThreadQuotaAtoms: () =>
      Atom.family((_key: string) => {
        state.quotaRequests++;
        return Atom.make(
          AsyncResult.success({
            status: "available" as const,
            checkedAt: "2026-10-31T12:00:00Z",
            dataAsOf: null,
            fiveHourPercent: null,
            weeklyPercent: state.weekly,
            balanceCredits: null,
          }),
        );
      }),
  };
});

import { ForkThreadQuota } from "./ForkThreadQuota";
const serverThread = { isServerThread: true };

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
      {...serverThread}
      environmentId={environmentId}
      threadId={threadId}
      usage={usage("account-one")}
    />,
  );
  await expect.element(page.getByText("Weekly 1.25%", { exact: true })).toBeVisible();
  await act(() => {
    state.nativeId = "native-two";
    state.weekly = 2.5;
    for (const notify of state.listeners) notify();
  });
  await expect.element(page.getByText("Weekly 2.5%", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Weekly 1.25%", { exact: true })).not.toBeInTheDocument();
  state.weekly = 3.75;
  await screen.rerender(
    <ForkThreadQuota
      {...serverThread}
      environmentId={environmentId}
      threadId={threadId}
      usage={usage("account-two")}
    />,
  );
  await expect.element(page.getByText("Weekly 3.75%", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Weekly 2.5%", { exact: true })).not.toBeInTheDocument();
});

it("does not subscribe to an unsent draft and starts normally when the same id is promoted", async () => {
  state.projectionReads = 0;
  state.quotaRequests = 0;
  state.weekly = 4.5;
  const props = {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("reserved-draft-thread"),
    isServerThread: false,
    usage: {
      providerInstanceId: ProviderInstanceId.make("codex"),
      providers: [{ instanceId: "codex", driver: ProviderDriverKind.make("codex"), auth: {} }],
    } as unknown as ThreadDetailsUsageInput,
  };
  await using screen = await render(<ForkThreadQuota {...props} />);
  expect(state.projectionReads).toBe(0);
  expect(state.quotaRequests).toBe(0);
  await expect.element(page.getByText("Codex quota used", { exact: true })).not.toBeInTheDocument();
  await screen.rerender(<ForkThreadQuota {...props} {...serverThread} />);
  await expect.element(page.getByText("Weekly 4.5%", { exact: true })).toBeVisible();
  expect(state.projectionReads).toBeGreaterThan(0);
  expect(state.quotaRequests).toBe(1);
});
