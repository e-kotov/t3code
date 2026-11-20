import { describe, expect, it } from "vite-plus/test";

import { filterScheduledTasks } from "./scheduledTaskSearch.ts";

const tasks = [
  { title: "Weekly REPORT", prompt: "Summarize open issues." },
  { title: "Morning digest", prompt: "Check the build report for failures." },
  { title: "Cleanup", prompt: "Review old branches." },
];

describe("filterScheduledTasks", () => {
  it("matches a title or prompt case-insensitively and preserves list order", () => {
    expect(filterScheduledTasks(tasks, "  RePoRt  ")).toEqual([tasks[0], tasks[1]]);
    expect(filterScheduledTasks(tasks, "deploy")).toEqual([]);
  });

  it("restores the full list when the search is cleared", () => {
    expect(filterScheduledTasks(tasks, "")).toBe(tasks);
    expect(filterScheduledTasks(tasks, "  ")).toBe(tasks);
  });
});
