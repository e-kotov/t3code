import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";
import { MobileContextControl } from "./MobileContextControl";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), allowed: true }));
vi.mock("react-native", () => ({
  Pressable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Circle: () => null,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => mocks.allowed,
  readEnvironmentScope: () => mocks.allowed,
}));
vi.mock("../../state/thread-outbox", () => ({ enqueueThreadOutboxMessage: mocks.enqueue }));
vi.mock("../../lib/commandMetadata", () => ({
  makeQueuedMessageMetadata: () => ({
    messageId: "msg",
    commandId: "cmd",
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeVariables: {} }),
}));
vi.mock("./ThreadCachePolicyMenu", () => ({
  ThreadCachePolicyMenu: ({
    children,
    actions,
    onPressAction,
  }: {
    children: ReactNode;
    actions: Array<{ id: string; title: string; attributes?: { disabled?: boolean } }>;
    onPressAction: (event: unknown) => void;
  }) => (
    <div>
      {children}
      {actions.map((action) => (
        <button
          key={action.id}
          disabled={action.attributes?.disabled}
          onClick={() => onPressAction({ nativeEvent: { event: action.id } })}
        >
          {action.title}
        </button>
      ))}
    </div>
  ),
}));

it("shows context and queues compaction only when allowed", async () => {
  mocks.allowed = true;
  mocks.enqueue.mockReset().mockResolvedValue(undefined);
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const hud = {
    driver: ProviderDriverKind.make("codex"),
    basis: "estimated",
    usage: { usedTokens: 84000, maxTokens: 258000, updatedAt: "2026-01-01T00:00:00.000Z" },
  } as const;
  const thread = {
    environmentId: "env",
    id: "thread",
    modelSelection: { instanceId: "codex", model: "model" },
  } as never;
  try {
    await act(() => root.render(<MobileContextControl hud={hud} thread={thread} />));
    expect(host.textContent).toContain("84k/258k");
    expect(host.textContent).toContain("84,000 / 258,000 tokens · 33% used");
    await act(() => host.querySelectorAll("button")[1]!.click());
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "/compact",
        compactAction: true,
        attachments: [],
        dispatchMode: "queue",
        environmentId: "env",
        threadId: "thread",
      }),
    );
    mocks.allowed = false;
    await act(() => root.render(<MobileContextControl hud={hud} thread={thread} />));
    expect(host.querySelectorAll("button")[1]!.disabled).toBe(true);
  } finally {
    act(() => root.unmount());
    globals.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
