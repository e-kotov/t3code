import {
  isCompactionCommandMessage,
  type OrchestrationV2CacheHud,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const IDLE_GRACE_MS = 5 * 60_000;

export function machineIdleWindow(
  completedAt: NonNullable<OrchestrationV2Run["completedAt"]>,
  idleMinutes: number,
  cacheExpiresAtMs = Infinity,
) {
  const startMs = DateTime.toEpochMillis(completedAt) + idleMinutes * 60_000;
  return { startMs, endMs: Math.min(startMs + IDLE_GRACE_MS, cacheExpiresAtMs) };
}

export function isUserIdleTurn(message: OrchestrationV2ConversationMessage) {
  return (
    message.createdBy === "user" &&
    message.scheduledTaskId === undefined &&
    !isCompactionCommandMessage(message)
  );
}

function reportedIdleCacheExpiryMs(hud: OrchestrationV2CacheHud): number | undefined {
  if (hud.usage.promptCacheExpiresAt !== undefined)
    return Date.parse(hud.usage.promptCacheExpiresAt);
  if (hud.basis === "reported" && hud.ttlMs !== undefined)
    return Date.parse(hud.usage.updatedAt) + hud.ttlMs;
  return undefined;
}

export function machineWarmWindow(
  completedAt: NonNullable<OrchestrationV2Run["completedAt"]>,
  idleMinutes: number,
  hud: OrchestrationV2CacheHud,
) {
  const expiry = reportedIdleCacheExpiryMs(hud);
  if (hud.driver === "claudeAgent" && (expiry === undefined || !Number.isFinite(expiry)))
    return null;
  return machineIdleWindow(completedAt, idleMinutes, expiry);
}

export function hasWarmCacheEvidence(hud: OrchestrationV2CacheHud): boolean {
  return (hud.usage.cachedInputTokens ?? 0) > 0 || (hud.usage.cacheCreationTokens ?? 0) > 0;
}
