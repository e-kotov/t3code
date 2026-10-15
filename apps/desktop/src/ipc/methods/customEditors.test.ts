import { expect, vi, beforeEach } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock("electron", () => ({ shell: { openExternal } }));
import { openCustomEditor } from "./customEditors.ts";

beforeEach(() => {
  openExternal.mockReset().mockResolvedValue(undefined);
});

it.effect("opens validated custom editor links through the OS", () =>
  Effect.gen(function* () {
    const opened = yield* openCustomEditor.handler({
      template: "myeditor://ssh/{host}{path}",
      host: "gwdg",
      target: "/my project",
    });
    expect(opened).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("myeditor://ssh/gwdg/my%20project");
  }),
);

it.effect("rejects unsafe protocols without asking the OS to open them", () =>
  Effect.gen(function* () {
    const opened = yield* openCustomEditor.handler({
      template: "file://{host}{path}",
      host: "gwdg",
      target: "/project",
    });
    expect(opened).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  }),
);

it.effect("reports OS handler failures", () =>
  Effect.gen(function* () {
    openExternal.mockRejectedValue(new Error("no handler"));
    const opened = yield* openCustomEditor.handler({
      template: "myeditor://ssh/{host}{path}",
      host: "gwdg",
      target: "/project",
    });
    expect(opened).toBe(false);
  }),
);
