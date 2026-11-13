import { isThreadWorking } from "./threadInbox.ts";

export function filterWorkingThreads<T extends Parameters<typeof isThreadWorking>[0]>(
  threads: readonly T[],
  workingOnly: boolean,
): readonly T[] {
  return workingOnly ? threads.filter(isThreadWorking) : threads;
}

export function workingSidebarFilterActive(
  workingOnly: boolean,
  machineScoped: boolean,
  projectScoped: boolean,
): boolean {
  return workingOnly || machineScoped || projectScoped;
}

export function orderWorkingSections<T>(
  active: readonly T[],
  working: readonly T[],
  workingFirst: boolean,
): T[] {
  return workingFirst ? [...working, ...active] : [...active, ...working];
}
