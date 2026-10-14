import { describe, expect, it } from "vite-plus/test";

import { resolveOpenInOptions } from "./OpenInPicker";

describe("fork editor picker options", () => {
  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "offers detected fork editors on %s",
    (platform) => {
      expect(
        resolveOpenInOptions(platform, ["positron", "gram"]).map(({ value, label }) => ({
          value,
          label,
        })),
      ).toEqual([
        { value: "positron", label: "Positron" },
        { value: "gram", label: "Gram" },
      ]);
    },
  );

  it("omits missing editors and preserves existing editor precedence", () => {
    expect(resolveOpenInOptions("MacIntel", ["vscode", "gram"]).map(({ value }) => value)).toEqual([
      "vscode",
      "gram",
    ]);
    expect(resolveOpenInOptions("MacIntel", [])).toEqual([]);
  });
});
