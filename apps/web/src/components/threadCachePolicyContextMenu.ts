import type { ContextMenuItem } from "@t3tools/contracts";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { cachePolicyChoices, cachePolicyDriver, threadCachePolicy } from "@t3tools/shared/threadCachePolicy";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { readLocalApi } from "../localApi";

type CacheThread = Pick<EnvironmentThreadShell, "environmentId" | "id" | "cacheHud" | "modelSelection">;

export async function showThreadCachePolicyMenu<T extends string>(thread: CacheThread, items: readonly ContextMenuItem<T>[], position?: { x: number; y: number }): Promise<T | null> {
  const api = readLocalApi();
  if (!api) return null;
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(thread.environmentId));
  if (!settings) return api.contextMenu.show(items, position);
  const driver = cachePolicyDriver(settings, thread.modelSelection.instanceId, thread.cacheHud?.driver);
  if (driver !== "codex" && driver !== "claudeAgent") return api.contextMenu.show(items, position);
  const policy = threadCachePolicy(settings, thread.id);
  const canWrite = readEnvironmentScope(thread.environmentId, AuthSettingsWriteScope);
  const choices = cachePolicyChoices(driver);
  const selected = await api.contextMenu.show<string>([
    ...items,
    { id: "cache-policy", label: "Idle cache policy", icon: "memory-stick", children: choices.map((choice) => ({
      id: `cache-policy:${choice.value}`, label: choice.label, checked: policy === choice.value, disabled: !canWrite,
    })) },
  ], position);
  if (selected === null) return null;
  const choice = choices.find((entry) => selected === `cache-policy:${entry.value}`);
  if (!choice) return selected as T;
  if (canWrite) await runAtomCommand(appAtomRegistry, serverEnvironment.updateSettings, {
    environmentId: thread.environmentId, input: { patch: { threadCachePolicies: { [thread.id]: choice.value } } },
  }, { label: "thread idle cache policy" });
  return null;
}
