import { msg } from "gt-react";
import { m } from "~/i18n/messages";
import {
  showThreadReferenceContextMenu,
  type ReferenceThread,
  type StartReferencedThread,
} from "./threadReferenceContextMenu";
import type { ContextMenuItem, ContextMenuSource } from "@t3tools/contracts";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  cachePolicyChoices,
  cachePolicyDriver,
  supportsThreadCachePolicy,
  threadCachePolicy,
} from "@t3tools/shared/threadCachePolicy";
import { supportsNeonCacheWarming } from "@t3tools/shared/cacheHud";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { readLocalApi } from "../localApi";

type CacheThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "cacheHud" | "modelSelection"
>;

async function showCachePolicyMenu<T extends string>(
  thread: CacheThread,
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
  source?: ContextMenuSource,
): Promise<T | null> {
  const api = readLocalApi();
  if (!api) return null;
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(thread.environmentId));
  if (!settings) return api.contextMenu.show(items, position, source);
  const driver = cachePolicyDriver(
    settings,
    thread.modelSelection.instanceId,
    thread.cacheHud?.driver,
  );
  const neonCacheWarming =
    driver === "antigravity" &&
    supportsNeonCacheWarming(
      appAtomRegistry.get(serverEnvironment.configValueAtom(thread.environmentId)),
    );
  if (!supportsThreadCachePolicy(driver, thread.modelSelection.model, neonCacheWarming))
    return api.contextMenu.show(items, position, source);
  const policy = threadCachePolicy(settings, thread.id);
  const canWrite = readEnvironmentScope(thread.environmentId, AuthSettingsWriteScope);
  const choices = cachePolicyChoices(driver);
  const selected = await api.contextMenu.show<string>(
    [
      ...items,
      {
        id: "cache-policy",
        label: m(msg("Idle cache policy")),
        icon: "memory-stick",
        children: choices.map((choice) => ({
          id: `cache-policy:${choice.value}`,
          label: choice.label,
          checked: policy === choice.value,
          disabled: !canWrite,
        })),
      },
    ],
    position,
    source,
  );
  if (selected === null) return null;
  const choice = choices.find((entry) => selected === `cache-policy:${entry.value}`);
  if (!choice) return selected as T;
  if (canWrite)
    await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.updateSettings,
      {
        environmentId: thread.environmentId,
        input: { patch: { threadCachePolicies: { [thread.id]: choice.value } } },
      },
      { label: "thread idle cache policy" },
    );
  return null;
}

export function showThreadCachePolicyMenu<T extends string>(
  thread: CacheThread & Partial<ReferenceThread>,
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
  start?: StartReferencedThread,
  source?: ContextMenuSource,
): Promise<T | null> {
  if (start && thread.projectId && thread.title !== undefined) {
    return showThreadReferenceContextMenu(
      {
        ...thread,
        projectId: thread.projectId,
        title: thread.title,
        branch: thread.branch ?? null,
        worktreePath: thread.worktreePath ?? null,
      },
      items,
      position,
      start,
      (menu, location) => showCachePolicyMenu(thread, menu, location, source),
    );
  }
  return showCachePolicyMenu(thread, items, position, source);
}
