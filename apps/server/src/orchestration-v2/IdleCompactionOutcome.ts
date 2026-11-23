import { idleCompactionOf } from "@t3tools/contracts";
import { isIdleMaintenanceMessageId } from "@t3tools/shared/threadCachePolicy";
import {
  ProviderAdapterTurnStartError,
  ProviderCompactionUnsupportedError,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2TurnMessage,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as Schema from "effect/Schema";

type Terminal = Extract<ProviderAdapterV2Event, { readonly type: "turn.terminal" }>;

export const IDLE_MAINTENANCE_SKIPPED = "Idle maintenance skipped before provider delivery";

export function isBackgroundIdleMessage(
  message: Pick<ProviderAdapterV2TurnMessage, "messageId" | "createdBy" | "creationSource">,
): boolean {
  return (
    message.creationSource === "server" &&
    message.createdBy !== "user" &&
    isIdleMaintenanceMessageId(message.messageId)
  );
}

const isTurnStartError = Schema.is(ProviderAdapterTurnStartError);
const isCompactionUnsupportedError = Schema.is(ProviderCompactionUnsupportedError);

export function idleCompactionStartOutcome(
  message: ProviderAdapterV2TurnMessage,
  cause: unknown,
  terminal: Terminal,
): Terminal {
  if (
    !isBackgroundIdleMessage(message) ||
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
    reason: IDLE_MAINTENANCE_SKIPPED,
    threadDisposition: "reusable",
  };
}
