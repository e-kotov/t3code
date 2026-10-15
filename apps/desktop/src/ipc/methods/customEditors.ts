import { buildCustomEditorUrl, CustomEditorUrlInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Electron from "electron";
import * as DesktopIpc from "../DesktopIpc.ts";

import { OPEN_CUSTOM_EDITOR_CHANNEL } from "../channels.ts";
export const openCustomEditor = DesktopIpc.makeIpcMethod({
  channel: OPEN_CUSTOM_EDITOR_CHANNEL,
  payload: CustomEditorUrlInput,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.openCustomEditor")(function* (input) {
    const url = buildCustomEditorUrl(input.template, input.host, input.target);
    if (url === undefined) return false;
    return yield* Effect.promise(() => Electron.shell.openExternal(url).then(() => true, () => false));
  }),
});
