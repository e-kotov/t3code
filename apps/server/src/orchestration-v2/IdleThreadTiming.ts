import type { OrchestrationV2Run } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const IDLE_GRACE_MS = 5 * 60_000;

export function machineIdleWindow(
  completedAt: NonNullable<OrchestrationV2Run["completedAt"]>,
  idleMinutes: number,
  cacheExpiresAt?: string,
) {
  const startMs = DateTime.toEpochMillis(completedAt) + idleMinutes * 60_000;
  const expiry = cacheExpiresAt === undefined ? Infinity : Date.parse(cacheExpiresAt);
  return { startMs, endMs: Math.min(startMs + IDLE_GRACE_MS, expiry) };
}
