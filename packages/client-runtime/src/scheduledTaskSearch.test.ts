import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createScheduledTaskSearch } from "./scheduledTaskSearch.ts";

const laptop = EnvironmentId.make("laptop");
const server = EnvironmentId.make("server");
const operations = ProjectId.make("operations");
const reporting = ProjectId.make("reporting");
const projects = [
  { environmentId: laptop, id: operations, title: "Operations" },
  { environmentId: laptop, id: reporting, title: "Financial Reports" },
  { environmentId: server, id: reporting, title: "Storage" },
];
const tasks = [
  { title: "Weekly REPORT", prompt: "Summarize open issues.", projectId: operations },
  { title: "Collect metrics", prompt: "Check storage usage.", projectId: reporting },
  {
    title: "Morning digest",
    prompt: "Check the build report for failures.",
    projectId: operations,
  },
];

describe("createScheduledTaskSearch", () => {
  it("matches titles and local project names case-insensitively with prompts off", () => {
    const search = createScheduledTaskSearch("  RePoRt  ", false, projects);
    expect(search.filter(tasks, laptop)).toEqual([tasks[0], tasks[1]]);
    expect(search.filter(tasks, server)).toEqual([tasks[0]]);
    expect(search.projectTitle(laptop, reporting)).toBe("Financial Reports");
    expect(search.projectTitle(server, reporting)).toBe("Storage");
    const accented = [
      { title: "Egor’s report", prompt: "", projectId: reporting },
      { title: "Inbox", prompt: "", projectId: operations },
    ];
    const cafeProjects = [{ environmentId: laptop, id: operations, title: "Café ops" }];
    const cafe = createScheduledTaskSearch("cafe", false, cafeProjects);
    expect(cafe.filter(accented, laptop)).toEqual([accented[1]]);
    const apostrophe = createScheduledTaskSearch("egor's", false, []);
    expect(apostrophe.filter(accented, laptop)).toEqual([accented[0]]);
  });

  it("adds prompt matches in list order when enabled", () => {
    expect(createScheduledTaskSearch("report", true, projects).filter(tasks, laptop)).toEqual(
      tasks,
    );
    expect(createScheduledTaskSearch("deploy", true, projects).filter(tasks, laptop)).toEqual([]);
  });

  it("restores the full list when the search is cleared", () => {
    const search = createScheduledTaskSearch("  ", true, projects);
    expect(search.active).toBe(false);
    expect(search.filter(tasks, laptop)).toBe(tasks);
  });
});
