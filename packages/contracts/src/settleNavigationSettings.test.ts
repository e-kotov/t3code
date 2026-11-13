import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { ClientSettingsPatch, ClientSettingsSchema } from "./settings.ts";

const decodeSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodePatch = Schema.decodeUnknownSync(ClientSettingsPatch);

it("keeps clients without a saved choice on the settled thread", () => {
  expect(decodeSettings({}).settleNavigation).toBe("stay");
  expect(decodeSettings({ confirmThreadDelete: false }).settleNavigation).toBe("stay");
});

it("accepts each saved choice and rejects unknown ones", () => {
  for (const choice of ["stay", "new-chat", "next-thread"] as const) {
    expect(decodeSettings({ settleNavigation: choice }).settleNavigation).toBe(choice);
    expect(decodePatch({ settleNavigation: choice })).toEqual({ settleNavigation: choice });
  }
  expect(() => decodePatch({ settleNavigation: "previous-thread" })).toThrow();
});
