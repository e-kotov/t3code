import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  filterWorkingThreads,
  orderWorkingSections,
  workingSidebarFilterActive,
} from "./workingSidebarView.ts";

const running = {
  latestRun: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  interactionMode: "default" as const,
  runtime: {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: null,
    lastError: null,
    updatedAt: "2026-11-13T12:00:00.000Z",
  },
};

describe("Working sidebar view", () => {
  it("keeps running and monitoring threads, but removes idle and actionable threads from a scoped list", () => {
    const threads = [
      { ...running, id: "run" },
      { ...running, id: "monitor", runtime: { ...running.runtime, status: "idle" as const } },
      { ...running, id: "idle", runtime: null },
      { ...running, id: "approval", hasPendingApprovals: true },
      { ...running, id: "question", hasPendingUserInput: true },
      { ...running, id: "child", pendingSubagentRequest: "approval" as const },
    ];
    expect(filterWorkingThreads(threads, true).map((thread) => thread.id)).toEqual([
      "run",
      "monitor",
    ]);
    expect(filterWorkingThreads(threads, false)).toBe(threads);
  });

  it("keeps the indicator active for an independent scope after Working is unchecked", () => {
    expect(workingSidebarFilterActive(true, false, false)).toBe(true);
    expect(workingSidebarFilterActive(false, true, false)).toBe(true);
    expect(workingSidebarFilterActive(false, false, true)).toBe(true);
    expect(workingSidebarFilterActive(false, false, false)).toBe(false);
  });

  it("moves the Working block without changing either block's internal sort", () => {
    const active = ["main-new", "main-old"];
    const working = ["run-new", "run-old"];
    expect(orderWorkingSections(active, working, false)).toEqual([...active, ...working]);
    expect(orderWorkingSections(active, working, true)).toEqual([...working, ...active]);
  });
});
