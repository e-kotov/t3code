import * as Schema from "effect/Schema";

/**
 * When the in-T3 stream of a BetterWright browser handoff fails, the desktop app can open the
 * remote host's own loopback viewer through an outbound SSH forward. The server hands out the
 * viewer capability only over an authenticated lease socket, and only for the active handoff;
 * the desktop resolves the SSH route from its own saved connection for that environment.
 */
export const BETTERWRIGHT_VIEWER_FALLBACK_PATH = "/api/betterwright-viewer-fallback";
export const BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH = `${BETTERWRIGHT_VIEWER_FALLBACK_PATH}/ws`;

/** Lease socket close codes. 4401 is never sent: refused credentials never reach the upgrade. */
export const BetterWrightViewerFallbackCloseCode = {
  forbidden: 4403,
  notFound: 4404,
  busy: 4409,
  ended: 4410,
} as const;

const LeaseId = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256));

/** The first and only server message on a lease socket. The token is the viewer capability. */
export const BetterWrightViewerLease = Schema.Struct({
  type: Schema.Literal("viewer"),
  environmentId: LeaseId,
  threadId: LeaseId,
  tabId: LeaseId,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  token: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,128}$/)),
});
export type BetterWrightViewerLease = typeof BetterWrightViewerLease.Type;

export const BETTERWRIGHT_VIEWER_FALLBACK_COMPLETE_MESSAGE = JSON.stringify({ type: "complete" });

export type BetterWrightViewerFallbackPhase = "connecting" | "open" | "closed" | "failed";

export interface BetterWrightViewerFallbackState {
  readonly sessionId: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly tabId: string;
  readonly phase: BetterWrightViewerFallbackPhase;
  /** User-facing explanation; never contains the viewer URL or token. */
  readonly message: string | null;
}

export type BetterWrightViewerFallbackAvailability =
  | { readonly available: true; readonly sshHost: string }
  | { readonly available: false; readonly reason: string };

export const BetterWrightViewerFallbackOpenInput = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String,
  tabId: Schema.String,
  /** The lease socket URL, including a single-use media ticket. Never logged. */
  leaseUrl: Schema.String,
});
export type BetterWrightViewerFallbackOpenInput = typeof BetterWrightViewerFallbackOpenInput.Type;

export interface BetterWrightViewerFallbackBridge {
  readonly availability: (environmentId: string) => Promise<BetterWrightViewerFallbackAvailability>;
  readonly open: (input: BetterWrightViewerFallbackOpenInput) => Promise<{ sessionId: string }>;
  /** Tells the agent the human finished; only the lease holding control can complete. */
  readonly complete: (sessionId: string) => Promise<void>;
  readonly close: (sessionId: string) => Promise<void>;
  readonly sessions: () => Promise<ReadonlyArray<BetterWrightViewerFallbackState>>;
  readonly onState: (listener: (state: BetterWrightViewerFallbackState) => void) => () => void;
}
