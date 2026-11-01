import type { ManagedPolicyDocument } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { managedUpdateRefusal } from "./forkManagedUpdates.ts";

it("applies managed update restrictions to EK prereleases", () => {
  const document: ManagedPolicyDocument = {
    schemaVersion: 1,
    organization: "Example Corp",
    limits: { updates: { mode: "auto", allowNightly: false } },
  };
  expect(managedUpdateRefusal(undefined, "ek")).toBeUndefined();
  expect(managedUpdateRefusal(document, "stable")).toBeUndefined();
  expect(managedUpdateRefusal(document, "ek")).toBe(managedUpdateRefusal(document, "nightly"));
  expect(managedUpdateRefusal(document, "ek")).toBeDefined();
  expect(managedUpdateRefusal({ ...document, limits: { updates: { mode: "auto" } } }, "ek")).toBeUndefined();
  expect(managedUpdateRefusal({ ...document, limits: { updates: { mode: "off" } } }, "ek")).toBeDefined();
});
