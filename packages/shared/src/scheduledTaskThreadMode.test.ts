import { ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { applyServerSettingsPatch } from "./serverSettings.ts";

const encode = Schema.encodeSync(ServerSettings);

it("defaults old settings to new threads and persists the explicit preference across unrelated edits", () => {
  const decode = Schema.decodeUnknownSync(ServerSettings);
  const patch = Schema.decodeUnknownSync(ServerSettingsPatch);
  const oldSettings = decode({});
  expect(oldSettings.scheduledTaskThreadMode).toBe("new-thread");
  const bound = applyServerSettingsPatch(
    oldSettings,
    patch({ scheduledTaskThreadMode: "current-thread" }),
  );
  const unrelated = applyServerSettingsPatch(bound, patch({ defaultAutoPull: true }));
  const persisted = decode(encode(unrelated));
  expect(persisted.scheduledTaskThreadMode).toBe("current-thread");
  expect(
    applyServerSettingsPatch(persisted, patch({ scheduledTaskThreadMode: "new-thread" }))
      .scheduledTaskThreadMode,
  ).toBe("new-thread");
  expect(() => patch({ scheduledTaskThreadMode: "invalid" })).toThrow();
});
