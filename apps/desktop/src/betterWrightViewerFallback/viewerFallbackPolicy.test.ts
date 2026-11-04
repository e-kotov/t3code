import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  SshConnectionProfile,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EMPTY_CONNECTION_CATALOG_DOCUMENT } from "@t3tools/client-runtime/platform";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  acceptLease,
  isViewerNavigationAllowed,
  leaseClosedMessage,
  leaseUrlProblem,
  NO_SSH_ROUTE_REASON,
  selectSshRoute,
  sshForwardFailureMessage,
  viewerForwardSshArgs,
  viewerWindowUrl,
} from "./viewerFallbackPolicy.ts";

const GWDG = EnvironmentId.make("environment-gwdg");
const RAVEN = EnvironmentId.make("environment-raven");
const sshTarget = { alias: "gwdg", hostname: "glogin.example", username: "ekotov", port: 2222 };

function catalog() {
  return {
    ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
    targets: [
      new BearerConnectionTarget({ environmentId: GWDG, label: "Tailscale", connectionId: "ts" }),
      new SshConnectionTarget({ environmentId: GWDG, label: "SSH", connectionId: "ssh-gwdg" }),
      new BearerConnectionTarget({ environmentId: RAVEN, label: "Tailscale", connectionId: "ts2" }),
    ],
    profiles: [
      new BearerConnectionProfile({
        connectionId: "ts",
        environmentId: GWDG,
        label: "Tailscale",
        httpBaseUrl: "https://gwdg.tailnet.example",
        wsBaseUrl: "wss://gwdg.tailnet.example",
      }),
      new SshConnectionProfile({
        connectionId: "ssh-gwdg",
        environmentId: GWDG,
        label: "SSH",
        target: sshTarget,
      }),
      // A profile filed under another environment must never route this one.
      new SshConnectionProfile({
        connectionId: "ts2",
        environmentId: GWDG,
        label: "Mislabeled",
        target: { alias: "elsewhere", hostname: "elsewhere", username: null, port: null },
      }),
    ],
  };
}

describe("SSH viewer fallback routing", () => {
  it("routes only through this environment's own saved SSH connection", () => {
    expect(selectSshRoute(catalog(), GWDG)).toEqual({ _tag: "Route", target: sshTarget });
    expect(selectSshRoute(catalog(), RAVEN)).toEqual({
      _tag: "Unavailable",
      reason: NO_SSH_ROUTE_REASON,
    });
    expect(selectSshRoute(catalog(), EnvironmentId.make("unknown"))._tag).toBe("Unavailable");
    expect(selectSshRoute({ ...catalog(), disabledEnvironmentIds: [GWDG] }, GWDG)._tag).toBe(
      "Unavailable",
    );
  });

  it("verifies host keys, forwards nothing back, and binds both ends to loopback", () => {
    const args = viewerForwardSshArgs(sshTarget, "ekotov@gwdg", {
      localPort: 41000,
      remotePort: 39123,
      batchMode: "yes",
    });
    const options = args.flatMap((arg, index) => (args[index - 1] === "-o" ? [arg] : []));
    for (const required of [
      "BatchMode=yes",
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
    ])
      expect(options).toContain(required);
    expect(
      options.some((option) => /StrictHostKeyChecking=(no|accept-new|off)/i.test(option)),
    ).toBe(false);
    expect(args).toEqual(expect.arrayContaining(["-a", "-x", "-N", "-p", "2222"]));
    expect(args.filter((arg) => arg === "-L")).toHaveLength(1);
    expect(args[args.indexOf("-L") + 1]).toBe("127.0.0.1:41000:127.0.0.1:39123");
    expect(args.some((arg) => arg === "-R" || arg === "-D" || arg === "-A" || arg === "-W")).toBe(
      false,
    );
    // Policy precedes the destination, and nothing runs remotely.
    expect(args.slice(-2)).toEqual(["--", "ekotov@gwdg"]);
  });

  it("accepts only its own fixed lease socket for the requested tab", () => {
    const expected = { threadId: "thread-1", tabId: "tab-1" };
    const good =
      "wss://gwdg.tailnet.example/api/betterwright-viewer-fallback/ws?threadId=thread-1&tabId=tab-1&wsTicket=x";
    expect(leaseUrlProblem(good, expected)).toBeNull();
    expect(
      leaseUrlProblem(
        "ws://127.0.0.1:41234/api/betterwright-viewer-fallback/ws?threadId=thread-1&tabId=tab-1",
        expected,
      ),
    ).toBeNull();
    for (const bad of [
      "not a url",
      good.replace("wss:", "https:"),
      good.replace("/api/betterwright-viewer-fallback/ws", "/api/preview-stream/ws"),
      good.replace("wss://", "wss://user:secret@"),
      good.replace("tabId=tab-1", "tabId=tab-2"),
      `${good}#fragment`,
    ])
      expect(leaseUrlProblem(bad, expected)).not.toBeNull();
  });

  it("rejects malformed, stale and mismatched leases without echoing their token", () => {
    const expected = { environmentId: "environment-gwdg", threadId: "thread-1", tabId: "tab-1" };
    const lease = {
      type: "viewer",
      environmentId: "environment-gwdg",
      threadId: "thread-1",
      tabId: "tab-1",
      port: 39123,
      token: "secret-viewer-token-123",
    };
    expect(acceptLease(JSON.stringify(lease), expected)).toEqual({ _tag: "Lease", lease });
    for (const raw of [
      "not json",
      new ArrayBuffer(4),
      JSON.stringify({ ...lease, port: 0 }),
      JSON.stringify({ ...lease, port: 70_000 }),
      JSON.stringify({ ...lease, token: "short" }),
      JSON.stringify({ ...lease, token: "has spaces and ?=& marks" }),
      JSON.stringify({ ...lease, type: "other" }),
      JSON.stringify({ ...lease, environmentId: "environment-raven" }),
      JSON.stringify({ ...lease, tabId: "tab-old" }),
    ]) {
      const decision = acceptLease(raw, expected);
      expect(decision._tag).toBe("Rejected");
      if (decision._tag === "Rejected") expect(decision.message).not.toContain(lease.token);
    }
  });

  it("separates refusal, missing handoff, foreign control, normal end and dropped connections", () => {
    const messages = [
      leaseClosedMessage(1006, false),
      leaseClosedMessage(4403, true),
      leaseClosedMessage(4404, true),
      leaseClosedMessage(4409, true),
      leaseClosedMessage(4410, true),
      leaseClosedMessage(1006, true),
    ];
    expect(new Set(messages).size).toBe(messages.length);
    expect(messages[0]).toContain("refused");
    expect(messages[2]).toContain("no active agent browser handoff");
    expect(sshForwardFailureMessage("gwdg", "Host key verification failed.")).toContain(
      "never accepts",
    );
    expect(
      sshForwardFailureMessage("gwdg", "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@"),
    ).toContain("never accepts");
    expect(sshForwardFailureMessage("gwdg", "Permission denied (publickey).")).toContain(
      "authentication",
    );
  });

  it("keeps the viewer window on its forwarded loopback origin", () => {
    expect(viewerWindowUrl(41000, "token_abc-123")).toBe("http://127.0.0.1:41000/?t=token_abc-123");
    expect(isViewerNavigationAllowed("http://127.0.0.1:41000/?t=x&auth=failed", 41000)).toBe(true);
    for (const target of [
      "http://127.0.0.1:41001/",
      "http://localhost:41000/",
      "https://127.0.0.1:41000/",
      "https://example.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ])
      expect(isViewerNavigationAllowed(target, 41000)).toBe(false);
  });
});
