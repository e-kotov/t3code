/**
 * Decides when a server browser stream has failed enough to offer the SSH viewer fallback.
 * A static page sends no frames, so health is judged by connection drops and a missing first
 * frame, never by frame recency. A pending credential refusal is never a stream failure.
 */
export interface StreamHealth {
  readonly since: number;
  readonly connectedAt: number | null;
  readonly disconnectedAt: number | null;
  readonly framed: boolean;
  readonly drops: ReadonlyArray<number>;
  readonly refusing: boolean;
}

const DISCONNECTED_MS = 6_000;
const NO_FIRST_FRAME_MS = 12_000;
const FLAP_WINDOW_MS = 30_000;
const FLAP_COUNT = 3;

export const initialStreamHealth = (now: number): StreamHealth => ({
  since: now,
  connectedAt: null,
  disconnectedAt: null,
  framed: false,
  drops: [],
  refusing: false,
});

export function streamConnectionChanged(
  health: StreamHealth,
  connected: boolean,
  now: number,
): StreamHealth {
  return connected
    ? { ...health, connectedAt: now, disconnectedAt: null, refusing: false }
    : {
        ...health,
        connectedAt: null,
        disconnectedAt: now,
        drops: [...health.drops.filter((at) => now - at < FLAP_WINDOW_MS), now],
      };
}

export const streamFramed = (health: StreamHealth): StreamHealth =>
  health.framed && !health.refusing ? health : { ...health, framed: true, refusing: false };

export const streamRefused = (health: StreamHealth): StreamHealth =>
  health.refusing ? health : { ...health, refusing: true };

export function streamNeedsFallback(health: StreamHealth, now: number): boolean {
  if (health.refusing) return false;
  if (health.disconnectedAt !== null && now - health.disconnectedAt >= DISCONNECTED_MS) return true;
  if (health.drops.filter((at) => now - at < FLAP_WINDOW_MS).length >= FLAP_COUNT) return true;
  return !health.framed && now - (health.connectedAt ?? health.since) >= NO_FIRST_FRAME_MS;
}
