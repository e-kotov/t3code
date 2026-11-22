import { idleCompactionOf } from "@t3tools/contracts";
import {
  ProviderAdapterTurnStartError,
  ProviderCompactionUnsupportedError,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2TurnMessage,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as Schema from "effect/Schema";

type Terminal = Extract<ProviderAdapterV2Event, { readonly type: "turn.terminal" }>;

const isTurnStartError = Schema.is(ProviderAdapterTurnStartError);
const isCompactionUnsupportedError = Schema.is(ProviderCompactionUnsupportedError);

export function idleCompactionStartOutcome(
  message: ProviderAdapterV2TurnMessage,
  cause: unknown,
  terminal: Terminal,
): Terminal {
  if (
    !message.messageId.startsWith("idle-compact:") ||
    idleCompactionOf({ ...message, role: "user" }) === undefined
  )
    return terminal;

  const startupError = isTurnStartError(cause) ? cause.cause : cause;
  if (!isCompactionUnsupportedError(startupError)) return terminal;

  return {
    type: terminal.type,
    driver: terminal.driver,
    providerThreadId: terminal.providerThreadId,
    providerTurnId: terminal.providerTurnId,
    runOrdinal: terminal.runOrdinal,
    status: "cancelled",
    failure: null,
    threadDisposition: "reusable",
  };
}
