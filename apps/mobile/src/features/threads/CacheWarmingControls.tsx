import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { AppText as Text } from "../../components/ui/AppText";
import { Pressable, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { cacheWarmingState, hotCacheThreadIds } from "@t3tools/shared/cacheHud";
import { environmentThreadShells } from "../../state/threads";

const EXPLANATION =
  "May send a short visible, billable cache-warm turn near cache expiry when enabled for this conversation.";

export function CacheWarmingEnvironmentControl(props: {
  readonly environmentId: EnvironmentId | null;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  if (props.environmentId === null) return null;
  return <EnvironmentControl environmentId={props.environmentId} threads={props.threads} />;
}

export function CacheWarmingToolbarControl(props: { readonly environmentId: EnvironmentId }) {
  const threads = useAtomValue(environmentThreadShells.threadShellsAtom);
  return <CacheWarmingEnvironmentControl {...props} threads={threads} />;
}

function EnvironmentControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "prompt cache warming setting",
  });
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const hotThreadIds = props.threads
    .filter((thread) => {
      const hud = thread.cacheHud;
      return (
        thread.environmentId === props.environmentId &&
        thread.archivedAt === null &&
        hud &&
        (hud.driver === "codex" || hud.driver === "claudeAgent") &&
        (hud.usage.cachedInputTokens ?? 0) + (hud.usage.cacheCreationTokens ?? 0) > 0 &&
        hud.ttlMs !== undefined &&
        Date.now() - Date.parse(hud.usage.updatedAt) < hud.ttlMs
      );
    })
    .map((thread) => thread.id);
  const enabled =
    hotThreadIds.length > 0 &&
    hotThreadIds.every((id) => settings?.cacheWarmingSessions?.[id] === true);
  return (
    <View className="h-9 flex-row items-center gap-2 rounded-full px-2">
      <View className="min-w-0">
        <Text className="text-xs">Warm cache</Text>
        <Text className="text-[9px] text-muted-foreground">
          This server · Codex/Claude · billable turns
        </Text>
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={`${enabled ? "Disable" : "Enable"} warming for all hot conversations`}
        accessibilityHint={`${EXPLANATION} Updates each hot conversation's toggle.`}
        accessibilityState={{ checked: enabled, disabled: !canWrite || hotThreadIds.length === 0 }}
        disabled={!canWrite || hotThreadIds.length === 0}
        onPress={() => {
          const value = !enabled;
          void updateSettings({
            environmentId: props.environmentId,
            input: {
              patch: {
                cacheWarmingSessions: Object.fromEntries(hotThreadIds.map((id) => [id, value])),
              },
            },
          });
        }}
        className={`rounded-full border px-3 py-1.5 ${enabled ? "border-primary bg-primary" : "border-border bg-surface"} ${!canWrite || hotThreadIds.length === 0 ? "opacity-40" : ""}`}
      >
        <Text className={`text-xs ${enabled ? "text-primary-foreground" : "text-foreground"}`}>
          {enabled ? "Warm all: On" : "Warm all: Off"}
        </Text>
      </Pressable>
    </View>
  );
}

/** Machine-group header switch: warms or cools every warm conversation on that
 * machine. Hidden while the machine has none, like the per-conversation control. */
export function CacheWarmingMachineControl(props: { readonly environmentId: EnvironmentId }) {
  const threads = useAtomValue(environmentThreadShells.threadShellsAtom);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "machine prompt cache warming setting",
  });
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const hotThreadIds = hotCacheThreadIds(
    threads.filter((thread) => thread.environmentId === props.environmentId),
    Date.now(),
  );
  if (hotThreadIds.length === 0) return null;
  const state = cacheWarmingState(hotThreadIds, settings?.cacheWarmingSessions);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={
        state === "mixed"
          ? "Warming is on for some warm conversations on this machine; enable it for all"
          : `${state === "on" ? "Disable" : "Enable"} warming for all warm conversations on this machine`
      }
      accessibilityHint={EXPLANATION}
      accessibilityState={{
        checked: state === "mixed" ? "mixed" : state === "on",
        disabled: !canWrite,
      }}
      disabled={!canWrite}
      hitSlop={6}
      onPress={() => {
        const value = state !== "on";
        void updateSettings({
          environmentId: props.environmentId,
          input: {
            patch: {
              cacheWarmingSessions: Object.fromEntries(hotThreadIds.map((id) => [id, value])),
            },
          },
        });
      }}
      className={`min-h-6 items-center justify-center rounded-full border px-2 ${state === "on" ? "border-primary bg-primary" : "border-border bg-transparent"} ${canWrite ? "" : "opacity-40"}`}
    >
      <Text
        className={`text-[11px] font-t3-medium ${state === "on" ? "text-primary-foreground" : "text-foreground-muted"}`}
      >
        {state === "mixed" ? "Warm: Mixed" : state === "on" ? "Warm: On" : "Warm: Off"}
      </Text>
    </Pressable>
  );
}

export function CacheWarmingThreadControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly driver?: string | null | undefined;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "conversation prompt cache warming setting",
  });
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const enabled = settings?.cacheWarmingSessions?.[props.threadId] === true;
  const unsupportedProvider = props.driver !== "codex" && props.driver !== "claudeAgent";
  const disabled = !canWrite || unsupportedProvider;
  const toggle = () => {
    void updateSettings({
      environmentId: props.environmentId,
      input: { patch: { cacheWarmingSessions: { [props.threadId]: !enabled } } },
    });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: enabled }}
      accessibilityLabel={`${enabled ? "Disable" : "Enable"} cache warming for this conversation`}
      accessibilityHint={
        unsupportedProvider
          ? "Prompt cache warming currently supports Codex and Claude only."
          : EXPLANATION
      }
      disabled={disabled}
      className={`ml-2 min-h-8 rounded-full border px-2.5 items-center justify-center ${enabled ? "border-primary bg-primary" : "border-border bg-transparent"} ${disabled ? "opacity-40" : ""}`}
      onPress={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <Text
        className={`text-[11px] font-t3-medium ${enabled ? "text-primary-foreground" : "text-foreground-muted"}`}
      >
        {unsupportedProvider ? "N/A" : enabled ? "Warm on" : "Warm off"}
      </Text>
    </Pressable>
  );
}
