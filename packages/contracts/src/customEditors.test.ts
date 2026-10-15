import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { LaunchEditorInput } from "./editor.ts";
import { buildCustomEditorUrl, customEditorArguments } from "./customEditorTemplates.ts";

it("accepts a custom executable without widening the detected-editor catalog", () => {
  const input = { cwd: "/my project", editor: "custom", customEditor: { name: "My editor", command: "/tools/editor", args: ["--goto", "{path}:{line}"] } };
  expect(Schema.decodeUnknownSync(LaunchEditorInput)(input)).toEqual(input);
  expect(() => Schema.decodeUnknownSync(LaunchEditorInput)({ cwd: "/repo", editor: "custom" })).toThrow();
  expect(() => Schema.decodeUnknownSync(LaunchEditorInput)({ ...input, editor: "anything" })).toThrow();
});

it("preserves spaces, quotes, Unicode and shell metacharacters as literal argv values", () => {
  expect(customEditorArguments(["--goto", "{path}:{line}:{column}", "$(do-not-run)"], '/my project/é \"$file.ts:12:4'))
    .toEqual(["--goto", '/my project/é \"$file.ts:12:4', "$(do-not-run)"]);
  expect(customEditorArguments(["--new-window"], "C:\\my project\\file.ts:8")).toEqual(["--new-window", "C:\\my project\\file.ts"]);
  expect(customEditorArguments(["--line", "{line}"], "/project")).toEqual(["--line", "1", "/project"]);
});

describe("custom SSH URL templates", () => {
  it("encodes path segments and query values without losing line positions", () => {
    expect(buildCustomEditorUrl("gram://ssh/{host}{path}", "gwdg", "/my project/#results:3:2"))
      .toBe("gram://ssh/gwdg/my%20project/%23results");
    expect(buildCustomEditorUrl("myeditor://ssh/{host}?path={pathQuery}&line={line}&column={column}", "gwdg", "/my project/#results:3:2"))
      .toBe("myeditor://ssh/gwdg?path=%2Fmy%20project%2F%23results&line=3&column=2");
  });
  it.each(["file", "javascript", "data", "shell", "http", "https", "ms-settings"])("rejects %s links", (scheme) => {
    expect(buildCustomEditorUrl(`${scheme}://{host}{path}`, "gwdg", "/a")).toBeUndefined();
  });
  it.each(["user@host", "host:22", "host/path", "host?query", "host\n"])("rejects malformed SSH hosts: %j", (host) => {
    expect(buildCustomEditorUrl("myeditor://ssh/{host}{path}", host, "/a")).toBeUndefined();
  });
  it.each(["myeditor://ssh/{host}", "myeditor://ssh/{path}", "myeditor://user:secret@ssh/{host}{path}", "{scheme}://ssh/{host}{path}", "myeditor://ssh/{host}{path}/{unknown}"])("rejects invalid templates: %s", (template) => {
    expect(buildCustomEditorUrl(template, "gwdg", "/a")).toBeUndefined();
  });
});
