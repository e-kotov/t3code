import { expect, it } from "vite-plus/test";
import { contextChipPresentation } from "./composerChipPresentation";

it("keeps assistant quotes recognizable with the shared review-comment icon", () => {
  expect(contextChipPresentation("assistantCitation")).toEqual({
    accent: "#8a70dd",
    icon: "message-circle",
  });
});
