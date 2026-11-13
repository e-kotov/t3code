import { EnvironmentId, ProjectId, type ScopedProjectRef } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { planSettleNavigation, type SettleNavigationTargets } from "./settleNavigation.logic";

const environmentId = EnvironmentId.make("environment-a");
const projectId = ProjectId.make("project-a");

function targets(openThreadKey: string) {
  const forward = vi.fn();
  const openedProjects: ScopedProjectRef[] = [];
  const planForwardNavigation = vi.fn<SettleNavigationTargets["planForwardNavigation"]>(
    (threadKey) => (threadKey === openThreadKey ? forward : null),
  );
  return {
    forward,
    openedProjects,
    planForwardNavigation,
    targets: {
      planForwardNavigation,
      threadByKeyRef: { current: new Map([["open", { environmentId, projectId }]]) },
      handleNewThread: async (projectRef: ScopedProjectRef) => {
        openedProjects.push(projectRef);
        return null;
      },
    } satisfies SettleNavigationTargets,
  };
}

describe("planSettleNavigation", () => {
  it.each(["stay", "new-chat", "next-thread"] as const)(
    "never navigates when %s settles a background thread",
    (mode) => {
      const { targets: input } = targets("open");
      expect(planSettleNavigation(mode, input, "background")).toBeNull();
    },
  );

  it("stays on the settled thread without planning the next one", () => {
    const { targets: input, planForwardNavigation } = targets("open");
    expect(planSettleNavigation("stay", input, "open")).toBeNull();
    expect(planForwardNavigation).not.toHaveBeenCalled();
  });

  it("keeps the upstream next-thread plan, including batch co-settling keys", () => {
    const { targets: input, forward, planForwardNavigation } = targets("open");
    const coSettlingKeys = new Set(["open", "other"]);
    expect(planSettleNavigation("next-thread", input, "open", coSettlingKeys)).toBe(forward);
    expect(planForwardNavigation).toHaveBeenCalledWith("open", coSettlingKeys);
  });

  it("opens an empty chat in the settled thread's project instead of another thread", () => {
    const { targets: input, forward, openedProjects } = targets("open");
    const navigate = planSettleNavigation("new-chat", input, "open");
    expect(openedProjects).toEqual([]);
    navigate?.();
    expect(openedProjects).toEqual([{ environmentId, projectId }]);
    expect(forward).not.toHaveBeenCalled();
  });
});
