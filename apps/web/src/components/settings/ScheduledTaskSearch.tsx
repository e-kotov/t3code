import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  makeScheduledTaskSearchAtom,
  scheduledTaskSearchInputAtom,
} from "@t3tools/client-runtime/scheduled-task-search";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { SearchIcon, XIcon } from "lucide-react";
import { useId, useRef } from "react";

import { environmentProjects } from "../../state/projects";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

const searchAtom = makeScheduledTaskSearchAtom(environmentProjects.projectsAtom);

export function Field() {
  const gt = useGT();
  const [{ query, includePrompts }, setInput] = useAtom(scheduledTaskSearchInputAtom);
  const input = useRef<HTMLInputElement>(null);
  const promptLabelId = useId();
  const label = gt("Search scheduled tasks");
  const setQuery = (next: string) => setInput({ query: next, includePrompts });

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2 px-3 sm:px-4">
      <div className="min-w-0 flex-1 basis-48">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !query) return;
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }}
            placeholder={label}
            aria-label={label}
          />
          {query ? (
            <InputGroupAddon align="inline-end">
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label={gt("Clear search")}
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
              >
                <XIcon />
              </Button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
        <Switch
          size="sm"
          checked={includePrompts}
          onCheckedChange={(checked) => setInput({ query, includePrompts: checked })}
          aria-labelledby={promptLabelId}
        />
        <span id={promptLabelId}>{gt("Search prompts too")}</span>
      </div>
    </div>
  );
}

export function useActive() {
  return useAtomValue(searchAtom).active;
}

/** Search-filtered tasks; callers keep the unfiltered list for task links. */
export function useFilter(
  tasks: readonly ScheduledTask[] | undefined,
  environmentId: EnvironmentId,
) {
  const search = useAtomValue(searchAtom);
  return tasks && search.filter(tasks, environmentId);
}

interface EnvironmentTasks {
  readonly environment: { readonly environmentId: EnvironmentId };
  readonly tasks: readonly ScheduledTask[] | undefined;
}

export function usePopulated<State extends EnvironmentTasks>(states: readonly State[]) {
  const search = useAtomValue(searchAtom);
  return states
    .map((state) => ({
      ...state,
      tasks: state.tasks && search.filter(state.tasks, state.environment.environmentId),
    }))
    .filter((state) => state.tasks && state.tasks.length > 0);
}

export function EmptyRow() {
  const gt = useGT();
  const active = useActive();
  return (
    <SettingsRow
      title={active ? gt("No matching tasks") : gt("No scheduled tasks")}
      description={
        active ? undefined : gt("No tasks match this environment and project selection.")
      }
    />
  );
}

export function RowDescription({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}) {
  const projectTitle = useAtomValue(searchAtom).projectTitle(environmentId, task.projectId);
  return (
    <>
      {projectTitle ? <span className="block truncate">{projectTitle}</span> : null}
      <span className="line-clamp-2">{task.prompt}</span>
    </>
  );
}
