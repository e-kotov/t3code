import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ClientSettingsSchema,
  isSidebarMachineGrouping,
  isSidebarProjectGrouping,
  toggleSidebarGroupingDimension,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

describe("sidebar conversation grouping", () => {
  it("decodes all grouping options in client settings", () => {
    expect(
      decodeClientSettings({ sidebarConversationGrouping: "none" }).sidebarConversationGrouping,
    ).toBe("none");
    expect(
      decodeClientSettings({ sidebarConversationGrouping: "machine" }).sidebarConversationGrouping,
    ).toBe("machine");
    expect(
      decodeClientSettings({ sidebarConversationGrouping: "project" }).sidebarConversationGrouping,
    ).toBe("project");
    expect(
      decodeClientSettings({ sidebarConversationGrouping: "both" }).sidebarConversationGrouping,
    ).toBe("both");
  });

  it("identifies machine and project grouping dimensions", () => {
    expect(isSidebarMachineGrouping("none")).toBe(false);
    expect(isSidebarMachineGrouping("project")).toBe(false);
    expect(isSidebarMachineGrouping("machine")).toBe(true);
    expect(isSidebarMachineGrouping("both")).toBe(true);

    expect(isSidebarProjectGrouping("none")).toBe(false);
    expect(isSidebarProjectGrouping("machine")).toBe(false);
    expect(isSidebarProjectGrouping("project")).toBe(true);
    expect(isSidebarProjectGrouping("both")).toBe(true);
  });

  it("toggles dimensions independently", () => {
    expect(toggleSidebarGroupingDimension("none", "machine")).toBe("machine");
    expect(toggleSidebarGroupingDimension("machine", "machine")).toBe("none");
    expect(toggleSidebarGroupingDimension("machine", "project")).toBe("both");
    expect(toggleSidebarGroupingDimension("both", "machine")).toBe("project");
    expect(toggleSidebarGroupingDimension("both", "project")).toBe("machine");
    expect(toggleSidebarGroupingDimension("project", "project")).toBe("none");
  });
});
