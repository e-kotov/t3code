import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
  type UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { compactUsageReport } from "./usageCompactReport";

const checkedAt = "2026-10-26T12:00:00Z";

function provider(id: string, failed = false): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", email: `${id}@example.com` },
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
