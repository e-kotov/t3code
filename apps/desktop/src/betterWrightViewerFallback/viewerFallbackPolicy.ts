import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
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

/** A live desktop-owned forward to an environment's T3 server, from T3's SSH manager. */
export interface SshTunnelEndpoint {
  readonly target: DesktopSshEnvironmentTarget;
  readonly httpBaseUrl: string;
}

const sameSshTarget = (a: DesktopSshEnvironmentTarget, b: DesktopSshEnvironmentTarget) =>
  a.alias === b.alias &&
  a.hostname === b.hostname &&
  a.username === b.username &&
  a.port === b.port;

const isLoopbackHttp = (raw: string) => {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" && url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

/** The lease socket the renderer derives from a prepared connection's HTTP base. */
const leaseSocketFor = (httpBaseUrl: string) =>
  environmentEndpointUrl(httpBaseUrl, BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH).replace(
    /^http/,
    "ws",
  );

/**
 * Lease sockets this device itself can vouch for: the environment's saved direct addresses, and
 * the loopback ends of T3's own live SSH forwards for its saved SSH routes. T3 Connect routes are
 * brokered at run time and cannot be vouched for here, so they are never included.
 */
export function leaseEndpoints(
  document: ConnectionCatalogDocument,
  environmentId: string,
  tunnels: ReadonlyArray<SshTunnelEndpoint>,
): ReadonlyArray<string> {
  if (document.disabledEnvironmentIds.some((id) => id === environmentId)) return [];
  const endpoints = new Set<string>();
  for (const route of document.targets) {
    if (route.environmentId !== environmentId || route._tag === "RelayConnectionTarget") continue;
    const profile = document.profiles.find(
      (candidate) =>
        candidate.connectionId === route.connectionId && candidate.environmentId === environmentId,
    );
    if (route._tag === "BearerConnectionTarget" && profile?._tag === "BearerConnectionProfile") {
      endpoints.add(leaseSocketFor(profile.httpBaseUrl));
    }
    if (route._tag === "SshConnectionTarget" && profile?._tag === "SshConnectionProfile") {
      for (const tunnel of tunnels) {
        if (sameSshTarget(tunnel.target, profile.target) && isLoopbackHttp(tunnel.httpBaseUrl))
          endpoints.add(leaseSocketFor(tunnel.httpBaseUrl));
      }
    }
  }
  return [...endpoints];
}

const LEASE_QUERY_KEYS = new Set(["threadId", "tabId", "wsTicket"]);

export type LeaseUrlDecision =
  | { readonly _tag: "Authorized"; readonly url: string }
  | { readonly _tag: "Refused"; readonly message: string };

/**
 * Accepts the renderer's lease address only when its origin and whole path equal one of the
 * device-vouched endpoints, and rebuilds it from that endpoint so nothing else is dialed. The
 * single-use ticket in it is therefore only ever sent to the environment's own server.
 */
export function authorizeLeaseUrl(
  raw: string,
  expected: { readonly threadId: string; readonly tabId: string },
  endpoints: ReadonlyArray<string>,
): LeaseUrlDecision {
  const refused = (message: string): LeaseUrlDecision => ({ _tag: "Refused", message });
  if (endpoints.length === 0) {
    return refused(
      "The SSH viewer needs this environment's saved direct address or a live T3 SSH connection. T3 Connect routes cannot be verified by the desktop.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refused("The browser lease address is invalid.");
  }
  const keys = [...url.searchParams.keys()];
  const endpoint = endpoints.find((candidate) => {
    const allowed = new URL(candidate);
    return allowed.origin === url.origin && allowed.pathname === url.pathname;
  });
  if (
    endpoint === undefined ||
    url.username ||
    url.password ||
    url.hash ||
    keys.some((key) => !LEASE_QUERY_KEYS.has(key)) ||
    new Set(keys).size !== keys.length ||
    url.searchParams.get("threadId") !== expected.threadId ||
    url.searchParams.get("tabId") !== expected.tabId
  ) {
    return refused(
      "The browser lease address does not belong to this environment's saved connection, so it was not used.",
    );
  }
  const authorized = new URL(endpoint);
  for (const [key, value] of url.searchParams) authorized.searchParams.set(key, value);
  return { _tag: "Authorized", url: authorized.toString() };
}

const decodeLease = Schema.decodeUnknownOption(Schema.fromJsonString(BetterWrightViewerLease));

type LeaseDecision =
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

/**
 * Runs in the viewer page before its own scripts. BetterWright's viewer lets any client switch,
 * open or close tabs across the whole daemon; this keeps the window's outgoing messages on the
 * handoff page and on http(s) navigation, as T3's own bridge does. It guards a window the user
 * controls, not the daemon: the SSH identity can reach the viewer directly anyway.
 */
export function viewerPageGuardScript(pageId: string): string {
  return `(() => {
  const pageId = ${JSON.stringify(pageId)};
  const proto = WebSocket.prototype;
  const send = proto.send;
  const allowed = (data) => {
    if (typeof data !== "string") return true;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return true;
    }
    if (typeof message !== "object" || message === null) return true;
    if (message.t === "newtab" || message.t === "closetab") return false;
    if (message.t === "tab") return message.id === pageId;
    if (message.t === "navigate") return typeof message.url === "string" && /^https?:\\/\\//.test(message.url);
    return true;
  };
  Object.defineProperty(proto, "send", {
    configurable: false,
    writable: false,
    value: function (data) {
      if (allowed(data)) return send.call(this, data);
    },
  });
})();`;
}
