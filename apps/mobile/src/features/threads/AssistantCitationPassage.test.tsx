import { expect, it, vi } from "vite-plus/test";

vi.mock("expo", () => ({
  requireOptionalNativeModule() {
    throw new Error("Native modules are unavailable");
  },
  requireNativeView: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-reanimated", () => ({ default: { View: "View" } }));

it("keeps the feed importable when optional native lookup fails", async () => {
  const { AssistantCitationPassage } = await import("./AssistantCitationPassage");
  expect(AssistantCitationPassage).toBeTypeOf("function");
});
