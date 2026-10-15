import { expect, it, vi, beforeEach } from "vite-plus/test";
import * as Effect from "effect/Effect";
const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock("electron", () => ({ shell: { openExternal } }));
import { openCustomEditor } from "./customEditors.ts";
beforeEach(() => openExternal.mockReset().mockResolvedValue(undefined));
it("opens validated custom editor links through the OS", async () => {
  expect(
    await Effect.runPromise(
      openCustomEditor.handler({
        template: "myeditor://ssh/{host}{path}",
        host: "gwdg",
        target: "/my project",
      }),
    ),
  ).toBe(true);
  expect(openExternal).toHaveBeenCalledWith("myeditor://ssh/gwdg/my%20project");
});
it("rejects unsafe protocols without asking the OS to open them", async () => {
  expect(
    await Effect.runPromise(
      openCustomEditor.handler({
        template: "file://{host}{path}",
        host: "gwdg",
        target: "/project",
      }),
    ),
  ).toBe(false);
  expect(openExternal).not.toHaveBeenCalled();
});
it("reports OS handler failures", async () => {
  openExternal.mockRejectedValue(new Error("no handler"));
  expect(
    await Effect.runPromise(
      openCustomEditor.handler({
        template: "myeditor://ssh/{host}{path}",
        host: "gwdg",
        target: "/project",
      }),
    ),
  ).toBe(false);
});
