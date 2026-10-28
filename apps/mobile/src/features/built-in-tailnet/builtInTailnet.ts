// The embedded node forwards connections without occupying Android's VPN slot.
import type { BuiltInTailnet } from "@t3tools/client-runtime/connection";
import { requireOptionalNativeModule } from "expo";
import * as Effect from "effect/Effect";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

export type BuiltInTailnetPosition = BuiltInTailnet.BuiltInTailnetPosition;

export interface BuiltInTailnetStatus {
  readonly state: "stopped" | "starting" | "needs-login" | "needs-approval" | "running";
  readonly authUrl?: string;
  readonly name?: string;
  readonly addresses?: ReadonlyArray<string>;
  readonly error?: string;
  readonly forwards: ReadonlyArray<{ target: string; port: number; active: number }>;
}

type Reply<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly error: string };

interface TailnetNative {
  isAvailable(): boolean;
  getConfig(): { enabled: boolean; position: string; signedIn: boolean };
  setConfig(enabled: boolean, position: string): void;
  start(idleTimeoutSeconds: number): Promise<string>;
  stop(): Promise<string>;
  logout(): Promise<string>;
  status(): Promise<string>;
  waitReady(timeoutMs: number): Promise<string>;
  forward(target: string): Promise<string>;
  logs(): Promise<string>;
  phoneShareStatus(): { enabled: boolean; status: string };
  setPhoneShareEnabled(enabled: boolean): void;
}

interface DirectNotificationsNative {
  directNotificationsEnabled(): boolean;
}

const native =
  Platform.OS === "android" ? requireOptionalNativeModule<TailnetNative>("T3Tailnet") : null;
const notifications =
  Platform.OS === "android"
    ? requireOptionalNativeModule<DirectNotificationsNative>("T3AgentNotifications")
    : null;

/** A node no connection uses, for example while SSH carries it, stops after this long. */
const IDLE_SECONDS = 300;
// Well inside the 15 s per route the connection supervisor allows an attempt.
const READY_TIMEOUT_MS = 10_000;

function parse<T>(json: string): Reply<T> {
  try {
    return JSON.parse(json) as Reply<T>;
  } catch {
    return { ok: false, error: "Unreadable reply from built-in Tailscale." };
  }
}

export function builtInTailnetAvailable(): boolean {
  return native?.isAvailable?.() === true;
}

const POSITIONS: ReadonlyArray<BuiltInTailnetPosition> = [
  "first",
  "before-tailscale",
  "after-tailscale",
  "last",
];

interface Snapshot {
  readonly enabled: boolean;
  readonly position: BuiltInTailnetPosition;
  readonly signedIn: boolean;
  readonly status: BuiltInTailnetStatus | null;
  readonly error: string | null;
  readonly phoneShare: { readonly enabled: boolean; readonly status: string };
}

function readConfig(): Pick<Snapshot, "enabled" | "position" | "signedIn"> {
  const config = builtInTailnetAvailable() ? native!.getConfig() : null;
  return {
    enabled: config?.enabled === true,
    position: POSITIONS.find((position) => position === config?.position) ?? "first",
    signedIn: config?.signedIn === true,
  };
}

let snapshot: Snapshot = {
  ...readConfig(),
  status: null,
  error: null,
  phoneShare: { enabled: false, status: "Off" },
};
const listeners = new Set<() => void>();

function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBuiltInTailnet(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function setBuiltInTailnetConfig(enabled: boolean, position: BuiltInTailnetPosition) {
  if (!builtInTailnetAvailable()) return;
  native!.setConfig(enabled, position);
  publish(readConfig());
  if (!enabled) void stopBuiltInTailnet();
}

function publishReply(reply: Reply<BuiltInTailnetStatus>) {
  // Native code records the sign-in state from every reply.
  publish(
    reply.ok
      ? { status: reply.result, error: null, signedIn: readConfig().signedIn }
      : { error: reply.error },
  );
  return reply.ok ? reply.result : null;
}

export async function refreshBuiltInTailnetStatus(): Promise<void> {
  if (!builtInTailnetAvailable()) return;
  publishReply(parse<BuiltInTailnetStatus>(await native!.status()));
  publish({ phoneShare: native!.phoneShareStatus() });
}

export function setPhoneSharing(enabled: boolean): void {
  if (!builtInTailnetAvailable()) throw new Error("Built-in Tailscale is unavailable.");
  native!.setPhoneShareEnabled(enabled);
  publish({ phoneShare: native!.phoneShareStatus() });
}

export async function stopBuiltInTailnet(): Promise<void> {
  if (!builtInTailnetAvailable()) return;
  publishReply(parse<BuiltInTailnetStatus>(await native!.stop()));
}

export async function signOutBuiltInTailnet(): Promise<void> {
  if (!builtInTailnetAvailable()) return;
  publishReply(parse<BuiltInTailnetStatus>(await native!.logout()));
}

export async function builtInTailnetLogs(): Promise<ReadonlyArray<string>> {
  if (!builtInTailnetAvailable()) return [];
  const reply = parse<{ lines: ReadonlyArray<string> }>(await native!.logs());
  return reply.ok ? reply.result.lines : [];
}

// While the user signs in from Settings, a connection attempt must not stop
// the node that is waiting for that login.
let signingIn = false;

/** Starts the node and waits until it runs or needs the user. */
async function startAndWait(): Promise<BuiltInTailnetStatus | null> {
  const started = publishReply(parse<BuiltInTailnetStatus>(await native!.start(IDLE_SECONDS)));
  if (started === null || started.state === "running") return started;
  return publishReply(parse<BuiltInTailnetStatus>(await native!.waitReady(READY_TIMEOUT_MS)));
}

/**
 * Starts the node for sign-in and returns the login page to open, or null
 * once it already runs.
 */
export async function beginBuiltInTailnetSignIn(): Promise<string | null> {
  if (!builtInTailnetAvailable()) return null;
  signingIn = true;
  const status = await startAndWait();
  if (status?.state === "needs-login" && status.authUrl) return status.authUrl;
  signingIn = false;
  return null;
}

export function endBuiltInTailnetSignIn() {
  signingIn = false;
}

async function forwardTargets(targets: ReadonlyArray<string>): Promise<Map<string, number>> {
  const ports = new Map<string, number>();
  const config = builtInTailnetAvailable() ? readConfig() : null;
  // Only a signed-in node takes part; signing in happens in Settings.
  if (config === null || !config.enabled || !config.signedIn) return ports;
  // In the background the node runs only for direct notifications.
  if (
    AppState.currentState !== "active" &&
    notifications?.directNotificationsEnabled?.() !== true
  ) {
    return ports;
  }
  const status = await startAndWait();
  if (status?.state !== "running") {
    // Signing in happens in Settings; do not keep a signed-out node polling.
    if (!signingIn && (status?.state === "needs-login" || status?.state === "needs-approval")) {
      await native!.stop();
    }
    return ports;
  }
  for (const target of targets) {
    const reply = parse<{ port: number }>(await native!.forward(target));
    if (reply.ok) ports.set(target, reply.result.port);
    else publish({ error: reply.error });
  }
  return ports;
}

/** What the connection driver sees; undefined where the module is missing. */
export const builtInTailnet: BuiltInTailnet.BuiltInTailnet | undefined =
  native === null
    ? undefined
    : {
        mode: () => {
          const config = readConfig();
          return config.enabled && config.signedIn ? config.position : "off";
        },
        forward: (targets) =>
          Effect.promise(() =>
            forwardTargets(targets).catch((error: unknown) => {
              publish({ error: error instanceof Error ? error.message : String(error) });
              return new Map<string, number>();
            }),
          ),
      };

/** Keeps the settings status fresh while a screen shows it. */
export function useBuiltInTailnetStatusPolling(active: boolean) {
  // oxlint-disable-next-line t3code/react-effect-budget -- Poll the native node while its settings are visible.
  useEffect(() => {
    if (!active || !builtInTailnetAvailable()) return;
    void refreshBuiltInTailnetStatus();
    const timer = setInterval(() => void refreshBuiltInTailnetStatus(), 2_000);
    return () => clearInterval(timer);
  }, [active]);
}
