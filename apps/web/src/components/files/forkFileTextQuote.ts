import * as Schema from "effect/Schema";

export const FileTextQuoteSchema = Schema.Struct({
  text: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  prefix: Schema.String,
  suffix: Schema.String,
});

export type FileTextQuote = typeof FileTextQuoteSchema.Type;
