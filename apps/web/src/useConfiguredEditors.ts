import {
  AuthOrchestrationOperateScope,
  buildRemoteOpenUrl,
  buildCustomEditorUrl,
  EnvironmentAuthorizationError,
  type EditorId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { mapAtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { usePreferredEditor } from "./editorPreferences";
import {
  configuredEditorEntries,
  preferredConfiguredEditor,
  useEditorPreferences,
} from "./forkEditorPreferences";
import {
  openRemoteEditorUrl,
  useRemoteCapableEditors,
  useRemoteOpenState,
  useRemoteOpenHint,
} from "./remoteOpen";
import { readEnvironmentScope } from "./state/session";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";

export function useConfiguredEditors(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
) {
  const remote = useRemoteOpenState(environmentId);
  const isRemote = remote.mode !== "local-exec";
  const probed = useRemoteCapableEditors();
  const [preferences, setPreferences] = useEditorPreferences(environmentId, isRemote);
  const entries = configuredEditorEntries(
    preferences,
    isRemote ? probed : availableEditors,
    isRemote,
  );
  const [legacy, setLegacy] = usePreferredEditor(
    entries.flatMap((entry) => (entry.builtIn ? [entry.builtIn] : [])),
  );
  const preferred = preferredConfiguredEditor(entries, preferences.preferred, legacy);
  const invoke = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const [remoteHintSeen, markRemoteHintSeen] = useRemoteOpenHint();
  const setPreferredEditor = (id: string) => {
    if (entries.some((entry) => entry.id === id && entry.builtIn)) setLegacy(id);
    setPreferences((value) => ({ ...value, preferred: id }));
  };
  const open = async (
    target: string,
    id?: string | null,
    options?: { readonly revealFileManager?: boolean; readonly isFile?: boolean },
  ) => {
    const entry = id == null ? preferred : entries.find((value) => value.id === id);
    if (environmentId === null || !entry || remote.mode === "remote-unavailable") {
      return AsyncResult.failure(
        Cause.fail(new Error("No configured editor or SSH route is available.")),
      );
    }
    if (remote.mode === "remote-links") {
      try {
        let opened = false;
        if (entry.custom) {
          const input = { template: entry.custom.remoteUrl, host: remote.host.host, target };
          const url = buildCustomEditorUrl(input.template, input.host, input.target);
          if (url === undefined) throw new Error("Invalid editor URL template.");
          if (window.desktopBridge) {
            if (!window.desktopBridge.openCustomEditor)
              throw new Error("Update the desktop app to use custom editor links.");
            opened = await window.desktopBridge.openCustomEditor(input);
          } else {
            window.location.assign(url);
            opened = true;
          }
        } else if (entry.builtIn) {
          const url = buildRemoteOpenUrl({
            editor: entry.builtIn,
            host: remote.host.host,
            absolutePath: target,
            isFile: options?.isFile ?? false,
          });
          if (url !== undefined) opened = await openRemoteEditorUrl(url);
        }
        if (!opened) throw new Error("The editor link could not be opened.");
        setPreferredEditor(entry.id);
        markRemoteHintSeen();
        return AsyncResult.success(entry.id);
      } catch (cause) {
        return AsyncResult.failure(
          Cause.fail(cause instanceof Error ? cause : new Error("Could not open the editor.")),
        );
      }
    }
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthOrchestrationOperateScope,
            message: "This connection cannot open an editor on this environment.",
          }),
        ),
      );
    }
    const result = await invoke({
      environmentId,
      input: entry.custom
        ? {
            cwd: target,
            editor: "custom",
            customEditor: {
              name: entry.name,
              command: entry.custom.command,
              args: entry.custom.args,
            },
          }
        : {
            cwd: target,
            editor: entry.builtIn!,
            ...(options?.revealFileManager && entry.builtIn === "file-manager"
              ? { reveal: true }
              : {}),
          },
    });
    if (result._tag === "Success") setPreferredEditor(entry.id);
    return mapAtomCommandResult(result, () => entry.id);
  };
  return {
    entries,
    preferredEditor: preferred?.id ?? null,
    preferredLabel: preferred?.name ?? null,
    setPreferredEditor,
    open,
    remote,
    remoteHintSeen,
  };
}
