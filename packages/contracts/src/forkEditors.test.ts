import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRemoteOpenUrl,
  EditorId,
  LaunchEditorInput,
  REMOTE_CAPABLE_EDITOR_IDS,
} from "./editor.ts";

describe("fork editor contracts", () => {
  it.each(["positron", "gram"])("accepts %s in editor RPC requests", (editor) => {
    expect(Schema.decodeUnknownSync(EditorId)(editor)).toBe(editor);
    expect(Schema.decodeUnknownSync(LaunchEditorInput)({ editor, cwd: "/my project" })).toEqual({
      editor,
      cwd: "/my project",
    });
    expect(REMOTE_CAPABLE_EDITOR_IDS).toContain(editor);
  });

  it("builds Positron's VS Code remote URI with encoded paths", () => {
    expect(
      buildRemoteOpenUrl({
        editor: "positron",
        host: "gwdg",
        absolutePath: "/home/ek/my project/#results",
      }),
    ).toBe("positron://vscode-remote/ssh-remote+gwdg/home/ek/my%20project/%23results");
  });

  it("builds Gram's SSH URI with encoded host and path segments", () => {
    expect(
      buildRemoteOpenUrl({
        editor: "gram",
        host: "my host",
        absolutePath: "/home/ek/my project/#results",
      }),
    ).toBe("gram://ssh/my%20host/home/ek/my%20project/%23results");
    expect(buildRemoteOpenUrl({ editor: "gram", host: "gwdg", absolutePath: "repo" })).toBe(
      "gram://ssh/gwdg/repo",
    );
  });
});
