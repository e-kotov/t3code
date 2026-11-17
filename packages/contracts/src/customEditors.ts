import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CustomEditorCommand = Schema.Struct({
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
});
export type CustomEditorCommand = typeof CustomEditorCommand.Type;

export const CustomEditorUrlInput = Schema.Struct({
  template: TrimmedNonEmptyString,
  host: TrimmedNonEmptyString,
  target: TrimmedNonEmptyString,
});
export type CustomEditorUrlInput = typeof CustomEditorUrlInput.Type;

export const CustomLaunchEditorInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  editor: Schema.Literal("custom"),
  customEditor: CustomEditorCommand,
  position: Schema.optional(
    Schema.Struct({
      line: Schema.optional(PositiveInt),
      column: Schema.optional(PositiveInt),
    }),
  ),
});
