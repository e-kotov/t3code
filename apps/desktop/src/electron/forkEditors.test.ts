import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ shell: {}, clipboard: {} }));

import { parseSafeExternalUrl } from "./ElectronShell.ts";

describe("fork editor external links", () => {
  it.each([
    "positron://vscode-remote/ssh-remote+gwdg/home/ek/my%20project",
    "gram://ssh/gwdg/home/ek/my%20project",
    "gram://ssh/gwdg/",
    "zed://ssh/user@gwdg/home/ek",
  ])("allows a project link: %s", (url) => {
    expect(Option.getOrNull(parseSafeExternalUrl(url))).toBe(url);
  });

  it.each([
    "gram://extension/attacker",
    "gram://ssh/",
    "gram://ssh/user@gwdg/home/ek",
    "gram://user:password@ssh/gwdg/home/ek",
    "positron://extension/attacker",
    "positron://vscode-remote/ssh-remote+",
    "positron://user:password@vscode-remote/ssh-remote+gwdg/home/ek",
  ])("keeps unrelated or credential-bearing links blocked: %s", (url) => {
    expect(Option.isNone(parseSafeExternalUrl(url))).toBe(true);
  });
});
