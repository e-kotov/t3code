import { describe, expect, it } from "@effect/vitest";

import { antigravityBrowserPreflightFailure } from "./forkAntigravityBrowserPreflight.ts";

const expectedLine = '__MARKER__"https://example.invalid/preflight"';
const clean = { bytes: 0, truncated: false };
const warning = "(node:1) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental";

describe("antigravityBrowserPreflightFailure", () => {
  it.each([
    ["only the marker", `${expectedLine}\n`],
    ["a warning before the marker", `${warning}\n${expectedLine}\n`],
    ["a warning after the marker", `${expectedLine}\n${warning}\n`],
    ["Windows line endings", `${warning}\r\n${expectedLine}\r\n`],
  ])("accepts %s", (_name, text) => {
    expect(
      antigravityBrowserPreflightFailure({
        exitCode: 0,
        stdout: clean,
        stderr: { text, truncated: false },
        expectedLine,
      }),
    ).toBeUndefined();
  });

  it.each([
    ["a missing marker", 0, clean, warning, false, "did not report"],
    ["a duplicate marker", 0, clean, `${expectedLine}\n${expectedLine}\n`, false, "did not report"],
    ["a marker inside a line", 0, clean, `x${expectedLine}\n`, false, "did not report"],
    ["a different URL", 0, clean, '__MARKER__"https://other.invalid"\n', false, "did not report"],
    ["stdout output", 0, { bytes: 1, truncated: false }, expectedLine, false, "stdout"],
    ["truncated stderr", 0, clean, expectedLine, true, "too much output"],
    ["a non-zero exit", 3, clean, expectedLine, false, "exited with code 3"],
  ])("rejects %s", (_name, exitCode, stdout, text, truncated, message) => {
    expect(
      antigravityBrowserPreflightFailure({
        exitCode,
        stdout,
        stderr: { text, truncated },
        expectedLine,
      }),
    ).toContain(message);
  });

  it("reports one bounded line of what Node wrote", () => {
    const text = `node: bad option: --nope\u001b[0m${"x".repeat(500)}\nsecond\n`;
    const failure = antigravityBrowserPreflightFailure({
      exitCode: 9,
      stdout: clean,
      stderr: { text, truncated: false },
      expectedLine,
    });
    expect(failure).toContain('Node reported: "node: bad option: --nope');
    expect(failure).toContain("NODE_OPTIONS");
    expect(failure).not.toContain("second");
    expect(failure).not.toContain("\u001b");
    expect(failure).not.toContain("x".repeat(201));
  });
});
