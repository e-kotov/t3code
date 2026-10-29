import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
  type UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { compactUsageReport, disconnectedEnvironmentLabels } from "./usageCompactReport";

const checkedAt = "2026-10-26T12:00:00Z";
const verifiedLimits = {
  checkedAt: "2026-10-26T11:59:30Z",
  credentialFingerprint: "google-account-fingerprint",
  windows: [
    {
      id: "gemini-pro-weekly",
      kind: "weekly",
      label: "Gemini Pro · Weekly",
      usedPercent: 25,
    },
  ],
} as const;

function provider(
  id: string,
  failed = false,
  driver = "codex",
  auth: ServerProvider["auth"]["status"] = "authenticated",
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: auth, email: `${id}@example.com` },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [{ id: "session", kind: "session", label: "5h", usedPercent: failed ? 100 : 0 }],
      ...(failed ? { unavailable: { reason: "probeFailed" as const } } : {}),
    },
  };
}

function presentations(
  providers: readonly ServerProvider[],
  usageLimitSources: UsageLimitSourceSnapshots = [],
) {
  return new Map([
    [
      EnvironmentId.make("test"),
      {
        entry: { target: { label: "Test" } },
        serverConfig: { providers, usageLimitSources },
      },
    ],
  ]);
}

it("reports an incomplete native pool instead of silently dropping a failed account", () => {
  const report = compactUsageReport(presentations([provider("good"), provider("failed", true)]));
  expect(report.accounts).toHaveLength(1);
  expect(report.accounts[0]?.email).toBe("good@example.com");
  expect(report.notices).toEqual(["codex: Could not read limits."]);
});

it("keeps source and individual proxy account failures visible", () => {
  const report = compactUsageReport(
    presentations(
      [provider("good")],
      [
        {
          id: UsageLimitSourceId.make("proxy"),
          kind: "cliproxy",
          label: "CLI Proxy",
          checkedAt,
          error: "Source probe failed",
          accounts: [
            {
              id: "failed",
              driver: ProviderDriverKind.make("claudeAgent"),
              usageLimits: { checkedAt, windows: [], unavailable: { reason: "probeFailed" } },
            },
          ],
        },
      ],
    ),
  );
  expect(report.accounts).toHaveLength(1);
  expect(report.notices).toEqual([
    "CLI Proxy: Source probe failed",
    "CLI Proxy · failed: Could not read limits.",
  ]);
});

it("shows only signed-in native providers and proxy accounts of the compact harnesses", () => {
  const report = compactUsageReport(
    presentations(
      [
        provider("signed-out", false, "claudeAgent", "unauthenticated"),
        provider("unread", true, "antigravity"),
        { ...provider("off", false, "codex"), enabled: false },
        provider("cursor", false, "cursor"),
      ],
      [
        {
          id: UsageLimitSourceId.make("proxy"),
          kind: "cliproxy",
          label: "CLI Proxy",
          checkedAt,
          accounts: [
            {
              id: "proxied",
              driver: ProviderDriverKind.make("codex"),
              usageLimits: {
                checkedAt,
                windows: [{ id: "session", kind: "session", label: "5h", usedPercent: 10 }],
              },
            },
          ],
        },
        {
          id: UsageLimitSourceId.make("other"),
          kind: "cliproxy",
          label: "Other Proxy",
          checkedAt,
          accounts: [
            {
              id: "cursor",
              driver: ProviderDriverKind.make("cursor"),
              usageLimits: { checkedAt, windows: [] },
            },
          ],
        },
      ],
    ),
  );
  expect([...report.drivers].toSorted()).toEqual(["antigravity", "codex"]);
  expect(report.accounts.map((account) => account.key)).toEqual(["proxy:proxied"]);
  expect(report.notices).toEqual(["antigravity: Could not read limits."]);
});

it("recognizes verified Antigravity quota access before a session confirms sign-in", () => {
  const report = compactUsageReport(
    presentations([
      {
        ...provider("google", false, "antigravity", "unknown"),
        status: "warning",
        usageLimits: verifiedLimits,
      },
    ]),
  );
  expect([...report.drivers]).toEqual(["antigravity"]);
  expect(report.accounts).toHaveLength(1);
  expect(report.notices).toEqual([]);
  expect(report).toMatchObject({
    authNotices: ["Antigravity quota access verified; session sign-in is not yet confirmed."],
  });
});

it("rejects signed-out, unverified, stale or mismatched quota authentication evidence", () => {
  const base = provider("google", false, "antigravity", "unknown");
  const report = compactUsageReport(
    presentations([
      { ...base, auth: { status: "unauthenticated" }, usageLimits: verifiedLimits },
      { ...base, driver: ProviderDriverKind.make("codex"), usageLimits: verifiedLimits },
      { ...base, usageLimits: { ...verifiedLimits, credentialFingerprint: undefined } },
      { ...base, usageLimits: { ...verifiedLimits, checkedAt: "2026-10-26T11:00:00Z" } },
      { ...base, usageLimits: { ...verifiedLimits, checkedAt: "2026-10-26T12:01:00Z" } },
      { ...base, usageLimits: { ...verifiedLimits, unavailable: { reason: "probeFailed" } } },
    ]),
  );
  expect([...report.drivers]).toEqual([]);
  expect(report.accounts).toEqual([]);
});

it("names every environment without an active connection and distinguishes unnamed entries", () => {
  const environment = (label: string, phase: string) => ({
    entry: { target: { label } },
    connection: { phase },
  });
  expect(
    disconnectedEnvironmentLabels([
      environment("mba15e", "connected"),
      environment("Phone", "offline"),
      environment("GWDG", "reconnecting"),
      environment("New host", "connecting"),
      environment(" ", "error"),
      environment("", "offline"),
    ]),
  ).toEqual(["GWDG", "New host", "Phone", "Unnamed environment 1", "Unnamed environment 2"]);
  expect(disconnectedEnvironmentLabels([environment("mba15e", "connected")])).toEqual([]);
});
