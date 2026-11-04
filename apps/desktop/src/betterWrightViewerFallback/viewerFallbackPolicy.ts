import type { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import {
  BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH,
  BetterWrightViewerFallbackCloseCode,
  BetterWrightViewerLease,
  type DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import { baseSshArgs } from "@t3tools/ssh/command";
import * as Schema from "effect/Schema";

/**
 * Pure rules for the SSH viewer fallback. The renderer names only an environment and a tab; the
 * SSH host comes from this device's saved connection for that environment, the remote port and
 * token from the server's authenticated lease, and every listener is loopback-only.
 */

export type SshRouteSelection =
  | { readonly _tag: "Route"; readonly target: DesktopSshEnvironmentTarget }
  | { readonly _tag: "Unavailable"; readonly reason: string };

export const NO_SSH_ROUTE_REASON =
  "Opening this browser over SSH needs an SSH connection saved for this environment in Settings → Connections.";

export function selectSshRoute(
  document: ConnectionCatalogDocument,
  environmentId: string,
): SshRouteSelection {
  if (document.disabledEnvironmentIds.some((id) => id === environmentId)) {
    return { _tag: "Unavailable", reason: "This environment is turned off in Settings." };
  }
  for (const route of document.targets) {
    if (route.environmentId !== environmentId || route._tag !== "SshConnectionTarget") continue;
    const profile = document.profiles.find(
      (candidate) =>
        candidate._tag === "SshConnectionProfile" &&
        candidate.connectionId === route.connectionId &&
        candidate.environmentId === environmentId,
    );
    if (profile?._tag === "SshConnectionProfile") return { _tag: "Route", target: profile.target };
  }
  return { _tag: "Unavailable", reason: NO_SSH_ROUTE_REASON };
}

/**
 * Policy options precede `--` so they override the user's ssh_config (first value wins). The
 * config still supplies routing (aliases, ProxyJump, keys) and any forwards it declares for the
 * host, as for T3's own SSH tunnels: ClearAllForwardings would also clear this `-L`.
 */
export function viewerForwardSshArgs(
  target: DesktopSshEnvironmentTarget,
  hostSpec: string,
  input: {
    readonly localPort: number;
    readonly remotePort: number;
    readonly batchMode: "yes" | "no";
  },
): string[] {
  return [
    ...baseSshArgs(target, { batchMode: input.batchMode }),
    ...[
      "StrictHostKeyChecking=yes",
      "UpdateHostKeys=no",
      "VerifyHostKeyDNS=no",
      "ForwardAgent=no",
      "ForwardX11=no",
      "PermitLocalCommand=no",
      "RemoteCommand=none",
      "ForkAfterAuthentication=no",
      "GatewayPorts=no",
      "ExitOnForwardFailure=yes",
      "ControlMaster=no",
      "ControlPath=none",
      "ControlPersist=no",
      "ServerAliveInterval=15",
      "ServerAliveCountMax=3",
    ].flatMap((option) => ["-o", option]),
    "-a",
    "-x",
    "-T",
    "-n",
    "-N",
    "-L",
    `127.0.0.1:${input.localPort}:127.0.0.1:${input.remotePort}`,
    "--",
    hostSpec,
  ];
}

/** Checks the renderer-supplied lease URL before the desktop dials it. Returns an error message. */
export function leaseUrlProblem(
  raw: string,
  expected: { readonly threadId: string; readonly tabId: string },
): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "The browser lease address is invalid.";
  }
  if (
    (url.protocol !== "ws:" && url.protocol !== "wss:") ||
    !url.pathname.endsWith(BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH) ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get("threadId") !== expected.threadId ||
    url.searchParams.get("tabId") !== expected.tabId
  ) {
    return "The browser lease address is invalid.";
  }
  return null;
}

const decodeLease = Schema.decodeUnknownOption(Schema.fromJsonString(BetterWrightViewerLease));

export type LeaseDecision =
  | { readonly _tag: "Lease"; readonly lease: BetterWrightViewerLease }
  | { readonly _tag: "Rejected"; readonly message: string };

export function acceptLease(
  raw: unknown,
  expected: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly tabId: string;
  },
): LeaseDecision {
  const decoded = typeof raw === "string" ? decodeLease(raw) : undefined;
  if (decoded === undefined || decoded._tag === "None") {
    return { _tag: "Rejected", message: "The T3 server sent an invalid browser lease." };
  }
  const lease = decoded.value;
  if (
    lease.environmentId !== expected.environmentId ||
    lease.threadId !== expected.threadId ||
    lease.tabId !== expected.tabId
  ) {
    return {
      _tag: "Rejected",
      message: "The browser lease belongs to another environment or tab, so it was not used.",
    };
  }
  return { _tag: "Lease", lease };
}

export function leaseClosedMessage(code: number, opened: boolean): string {
  if (!opened) {
    return "The T3 server refused or could not take the browser lease. Reconnect to the environment and try again.";
  }
  switch (code) {
    case BetterWrightViewerFallbackCloseCode.forbidden:
      return "This connection is not allowed to operate the browser.";
    case BetterWrightViewerFallbackCloseCode.notFound:
      return "This tab has no active agent browser handoff.";
    case BetterWrightViewerFallbackCloseCode.busy:
      return "Someone else controls this page in T3. Release control there first.";
    case BetterWrightViewerFallbackCloseCode.ended:
      return "The browser handoff ended.";
    default:
      return "The connection to the T3 server dropped, so the SSH viewer was closed to keep control with T3.";
  }
}

export function sshForwardFailureMessage(alias: string, stderr: string): string {
  if (/host key verification failed|remote host identification has changed/i.test(stderr)) {
    return `SSH could not verify the host key for ${alias}. Check the host's identity in Terminal; T3 never accepts new or changed host keys.`;
  }
  if (/no .* host key is known|host key for .* is not known/i.test(stderr)) {
    return `${alias} is not in known_hosts yet. Connect once in Terminal and verify its fingerprint.`;
  }
  if (/permission denied|authentication failed|too many authentication failures/i.test(stderr)) {
    return `SSH authentication to ${alias} failed.`;
  }
  return `The SSH connection to ${alias} closed.`;
}

export const viewerWindowUrl = (localPort: number, token: string) =>
  `http://127.0.0.1:${localPort}/?t=${encodeURIComponent(token)}`;

/** The viewer window stays on its own loopback origin; links elsewhere are refused. */
export function isViewerNavigationAllowed(raw: string, localPort: number): boolean {
  try {
    return new URL(raw).origin === `http://127.0.0.1:${localPort}`;
  } catch {
    return false;
  }
}
