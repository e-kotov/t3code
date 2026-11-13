import type * as Context from "effect/Context";
import { it, vi } from "vite-plus/test";
import type { FakeDriver } from "../../../test/fakeEnvironment";
import { runSettleNavigationScenario } from "./settleNavigationScenario";

// Browser mock factories belong to the test entry, before its app helper loads.
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
// The fake environment never answers file reads; a project without t3.json reads as null.
vi.mock(import("~/lib/t3ProjectFileDefaults"), async (original) => ({
  ...(await original()),
  readT3ProjectFile: async () => null,
}));
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+shift+s", command: "thread.settle", when: "!terminalFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});

it("opens a new chat in the same project when chosen", async () => {
  await runSettleNavigationScenario("new-chat", "new-chat");
});
