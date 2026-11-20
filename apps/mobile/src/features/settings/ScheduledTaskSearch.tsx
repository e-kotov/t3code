import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  makeScheduledTaskSearchAtom,
  scheduledTaskSearchInputAtom,
} from "@t3tools/client-runtime/scheduled-task-search";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { useGT } from "gt-react-native";

import type { AppBarSearch } from "../../components/ui/AppBar.types";
import { AppText } from "../../components/ui/AppText";
import { environmentProjects } from "../../state/projects";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const searchAtom = makeScheduledTaskSearchAtom(environmentProjects.projectsAtom);

export function useHeaderSearch(): AppBarSearch {
  const gt = useGT();
  const [{ query, includePrompts }, setInput] = useAtom(scheduledTaskSearchInputAtom);
  return {
    value: query,
    onChangeText: (next) => setInput({ query: next, includePrompts }),
    placeholder: gt("Search scheduled tasks"),
    mode: "inline",
    compactToolbar: false,
  };
}

export function Options() {
  const gt = useGT();
  const [{ query, includePrompts }, setInput] = useAtom(scheduledTaskSearchInputAtom);
  return (
    <SettingsSection>
      <SettingsSwitchRow
        label={gt("Search prompts too")}
        value={includePrompts}
        onValueChange={(next) => setInput({ query, includePrompts: next })}
      />
    </SettingsSection>
  );
}

export function useMatcher(environmentId: EnvironmentId) {
  const search = useAtomValue(searchAtom);
  return (task: ScheduledTask) => search.matches(task, environmentId);
}

export function EmptyText({ projectSelected }: { readonly projectSelected: boolean }) {
  const gt = useGT();
  const { active } = useAtomValue(searchAtom);
  if (active) return gt("No matching tasks");
  return projectSelected ? gt("No tasks in this project.") : gt("No scheduled tasks yet.");
}

/** While searching, shows what a match can come from that the row does not already show. */
export function RowMatch({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}) {
  const search = useAtomValue(searchAtom);
  const projectTitle = search.projectTitle(environmentId, task.projectId);
  return (
    <>
      {projectTitle === undefined ? null : (
        <AppText className="text-sm text-foreground-muted" numberOfLines={1}>
          {projectTitle}
        </AppText>
      )}
      {search.active && search.includePrompts ? (
        <AppText className="text-sm text-foreground-muted" numberOfLines={2}>
          {task.prompt}
        </AppText>
      ) : null}
    </>
  );
}
