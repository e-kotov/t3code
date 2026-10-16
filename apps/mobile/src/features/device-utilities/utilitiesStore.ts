import {
  UtilitySnapshot,
  utilityAggregate,
  utilityStatuses,
  type UtilitySnapshot as Snapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";
import { useSyncExternalStore } from "react";

interface NativeUtilities {
  utilitiesSnapshot(): string;
  utilitiesImport(): void;
  utilitiesCheck(serviceId: string, revision: number): void;
  utilitiesAction(serviceId: string, actionId: string, revision: number): void;
}
const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeUtilities>("T3TermuxCommand")
    : null;
export const utilitiesAvailable = typeof native?.utilitiesSnapshot === "function";
const decode = Schema.decodeUnknownSync(UtilitySnapshot);
let state: { snapshot: Snapshot | null; error: string | null; now: number } = {
  snapshot: null,
  error: null,
  now: Date.now(),
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let appSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
let lastRead = 0;
function publish(snapshot: Snapshot | null, error: string | null) {
  state = { snapshot, error, now: Date.now() };
  for (const listener of listeners) listener();
}
export function refreshUtilities(manual = false) {
  if (!utilitiesAvailable || !native) return;
  try {
    let snapshot = decode(JSON.parse(native.utilitiesSnapshot()));
    const now = Date.now();
    if (!snapshot.error && snapshot.config) {
      for (const service of snapshot.config.services) {
        if (
          !service.enabled ||
          snapshot.actions.some((r) => r.serviceId === service.id && r.finishedAt === null)
        )
          continue;
        const last = snapshot.checks.find((r) => r.serviceId === service.id);
        const due =
          !last ||
          (last.finishedAt !== null &&
            (manual ||
              (service.intervalSeconds > 0 &&
                now - last.startedAt >= service.intervalSeconds * 1000)));
        if (due) native.utilitiesCheck(service.id, snapshot.revision);
      }
      snapshot = decode(JSON.parse(native.utilitiesSnapshot()));
    }
    lastRead = now;
    publish(snapshot, null);
  } catch (cause) {
    publish(state.snapshot, String(cause));
  }
}
function tick() {
  if (AppState.currentState !== "active") return;
  const running =
    state.snapshot?.checks.some((r) => r.finishedAt === null) ||
    state.snapshot?.actions.some((r) => r.finishedAt === null) ||
    state.snapshot?.error?.includes("Importing");
  if (running || Date.now() - lastRead >= 10_000) refreshUtilities();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && utilitiesAvailable) {
    appSubscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refreshUtilities(true);
    });
    timer = setInterval(tick, 2000);
    if (AppState.currentState === "active") refreshUtilities(true);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (timer) clearInterval(timer);
      appSubscription?.remove();
    }
  };
}
export function useDeviceUtilities() {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  const statuses = current.snapshot ? utilityStatuses(current.snapshot, current.now) : [];
  return {
    ...current,
    statuses,
    aggregate: current.error ? ("unknown" as const) : utilityAggregate(statuses),
  };
}
export function importUtilities() {
  try {
    native?.utilitiesImport();
    refreshUtilities();
  } catch (cause) {
    publish(state.snapshot, String(cause));
  }
}
export function runUtilityAction(serviceId: string, actionId: string, revision: number) {
  try {
    native?.utilitiesAction(serviceId, actionId, revision);
    refreshUtilities();
  } catch (cause) {
    publish(state.snapshot, String(cause));
  }
}
