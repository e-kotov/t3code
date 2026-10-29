import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { type ProfileReport, type ReportedProfiles, takeDueProfileReports } from "./BrowserProfileReporter";

it("reports proxy changes and switching off while preserving ordinary report deduplication", () => {
  const id = EnvironmentId.make("host");
  const targets = new Map([[id, {} as EnvironmentServerConfig]]);
  const reported: ReportedProfiles = new Map();
  const input: ProfileReport = { profiles: [], defaultProfileId: "default", recordingFrameRate: 30, proxyUrl: "" };
  expect(takeDueProfileReports(reported, targets, input)).toEqual([id]);
  const enabled = { ...input, proxyUrl: "socks5://127.0.0.1:1080" };
  expect(takeDueProfileReports(reported, targets, enabled)).toEqual([id]);
  expect(takeDueProfileReports(reported, targets, { ...enabled })).toEqual([]);
  expect(takeDueProfileReports(reported, targets, input)).toEqual([id]);
});
