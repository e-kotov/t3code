import {
  UtilitySnapshot,
  utilityAggregate,
  utilityStatuses,
  type DeviceUtilitiesBridge,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { create } from "zustand";

const decode = Schema.decodeUnknownSync(UtilitySnapshot);
export const getUtilitiesBridge = (): DeviceUtilitiesBridge | null =>
  typeof window === "undefined" ? null : (window.desktopBridge?.deviceCommands?.utilities ?? null);
export const useUtilitiesStore = create<{
  snapshot: UtilitySnapshot | null;
  error: string | null;
  now: number;
}>(() => ({ snapshot: null, error: null, now: Date.now() }));
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let reading = false;
let heartbeatAt = 0;
export async function refreshUtilities() {
  const bridge = getUtilitiesBridge();
  if (!bridge || reading) return;
  reading = true;
  try {
    useUtilitiesStore.setState({
      snapshot: decode(await bridge.snapshot()),
      now: Date.now(),
      error: null,
    });
  } catch (cause) {
    useUtilitiesStore.setState({ error: String(cause), now: Date.now() });
  } finally {
    reading = false;
  }
}
function heartbeat() {
  const bridge = getUtilitiesBridge();
  if (!bridge) return;
  const visible = document.visibilityState === "visible";
  if (Date.now() - heartbeatAt >= 30_000) {
    heartbeatAt = Date.now();
    void bridge
      .active(visible)
      .catch((cause) => useUtilitiesStore.setState({ error: String(cause) }));
  }
  if (visible) void refreshUtilities();
}
function visibilityChanged() {
  heartbeatAt = 0;
  heartbeat();
}
/** Shares one heartbeat between all mounted views; returns the matching unsubscribe. */
function subscribeUtilities() {
  if (!getUtilitiesBridge()) return undefined;
  subscribers += 1;
  if (subscribers === 1) {
    heartbeatAt = 0;
    document.addEventListener("visibilitychange", visibilityChanged);
    timer = setInterval(heartbeat, 3000);
    heartbeat();
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0) {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      void getUtilitiesBridge()
        ?.active(false)
        .catch(() => undefined);
    }
  };
}
export function useDeviceUtilities() {
  const state = useUtilitiesStore();
  useEffect(() => subscribeUtilities(), []);
  const statuses = state.snapshot ? utilityStatuses(state.snapshot, state.now) : [];
  return {
    ...state,
    statuses,
    aggregate: state.error ? ("unknown" as const) : utilityAggregate(statuses),
  };
}
export async function reloadUtilities() {
  try {
    const snapshot = await getUtilitiesBridge()?.reload();
    if (snapshot)
      useUtilitiesStore.setState({ snapshot: decode(snapshot), error: null, now: Date.now() });
  } catch (cause) {
    useUtilitiesStore.setState({ error: String(cause) });
  }
}
export async function checkUtilities() {
  await getUtilitiesBridge()?.check();
  await refreshUtilities();
}
