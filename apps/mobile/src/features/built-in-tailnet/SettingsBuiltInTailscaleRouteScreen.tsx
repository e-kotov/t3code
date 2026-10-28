import { useIsFocused } from "@react-navigation/native";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { Alert, Linking } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsChoiceRow } from "../settings/components/SettingsChoiceRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  beginBuiltInTailnetSignIn,
  builtInTailnetAvailable,
  builtInTailnetLogs,
  type BuiltInTailnetPosition,
  type BuiltInTailnetStatus,
  endBuiltInTailnetSignIn,
  setBuiltInTailnetConfig,
  setPhoneSharing,
  signOutBuiltInTailnet,
  stopBuiltInTailnet,
  useBuiltInTailnet,
  useBuiltInTailnetStatusPolling,
} from "./builtInTailnet";

const POSITIONS: ReadonlyArray<{
  readonly value: BuiltInTailnetPosition;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "first",
    label: "First",
    description: "Try built-in Tailscale before every saved route.",
  },
  {
    value: "before-tailscale",
    label: "Before the Tailscale app route",
    description: "For example: SSH tunnel, then built-in Tailscale, then the Tailscale app.",
  },
  {
    value: "after-tailscale",
    label: "After the Tailscale app route",
    description: "For example: Tailscale app, then built-in Tailscale, then SSH tunnel.",
  },
  {
    value: "last",
    label: "Last",
    description: "Only when no saved route connects.",
  },
];

function describeStatus(status: BuiltInTailnetStatus | null, signedIn: boolean): string {
  switch (status?.state) {
    case undefined:
    case "stopped":
      return signedIn
        ? "Signed in, not running. It starts when a connection needs it."
        : "Not signed in. Built-in Tailscale is used only after you sign in.";
    case "starting":
      return "Connecting to Tailscale…";
    case "needs-login":
      return "Not signed in.";
    case "needs-approval":
      return "Waiting for approval in the Tailscale admin console.";
    case "running": {
      const address = status.addresses?.[0];
      const forwards = status.forwards.reduce((sum, forward) => sum + forward.active, 0);
      return `Connected as ${status.name ?? "this phone"}${address ? ` (${address})` : ""}. ${
        forwards === 1 ? "1 open connection" : `${forwards} open connections`
      }.`;
    }
  }
}

export function SettingsBuiltInTailscaleRouteScreen() {
  const focused = useIsFocused();
  const { enabled, position, signedIn, status, error, phoneShare } = useBuiltInTailnet();
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<ReadonlyArray<string> | null>(null);
  useBuiltInTailnetStatusPolling(focused);
  useEffect(() => {
    if (status?.state === "running") endBuiltInTailnetSignIn();
  }, [status?.state]);
  useEffect(() => endBuiltInTailnetSignIn, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    const result = await settlePromise(work);
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      Alert.alert("Built-in Tailscale", cause instanceof Error ? cause.message : String(cause));
    }
  };
  const signIn = () =>
    run(async () => {
      const url = await beginBuiltInTailnetSignIn();
      if (url !== null) await Linking.openURL(url);
    });

  if (!builtInTailnetAvailable()) {
    return (
      <SettingsScreen title="Built-in Tailscale">
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-5 pt-4"
        >
          <Text className="text-base text-foreground-muted">
            Built-in Tailscale is not part of this app build.
          </Text>
        </ScrollView>
      </SettingsScreen>
    );
  }

  const running = status?.state === "running";
  return (
    <SettingsScreen title="Built-in Tailscale">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4 pb-8"
      >
        <SettingsSection>
          <SettingsSwitchRow
            icon="point.3.connected.trianglepath.dotted"
            label="Built-in Tailscale"
            value={enabled}
            subtitle="Reach servers on your tailnet without the Tailscale app. Other apps and VPNs are not affected."
            onValueChange={(value) => setBuiltInTailnetConfig(value, position)}
          />
        </SettingsSection>

        <SettingsSection title="Remote access to this phone">
          <SettingsSwitchRow
            icon="point.3.connected.trianglepath.dotted"
            label="Share this phone on Tailscale"
            value={phoneShare.enabled}
            subtitle={`${phoneShare.status}. Starts the phone T3 server and stays on until stopped.`}
            disabled={!phoneShare.enabled && (!enabled || !signedIn)}
            onValueChange={(value) => void run(async () => setPhoneSharing(value))}
          />
        </SettingsSection>

        <SettingsSection
          title="Position among saved routes"
          footer="Order the saved routes, such as your SSH tunnel and the Tailscale app address, under Environments."
        >
          {POSITIONS.map((option, index) => (
            <SettingsChoiceRow
              key={option.value}
              label={option.label}
              description={option.description}
              selected={position === option.value}
              separated={index > 0}
              disabled={!enabled}
              onPress={() => setBuiltInTailnetConfig(enabled, option.value)}
            />
          ))}
        </SettingsSection>

        <SettingsSection title="Tailscale account" footer={error ?? undefined}>
          {running ? (
            <>
              <SettingsActionRow
                icon="stop.fill"
                label="Disconnect now"
                disabled={busy}
                onPress={() => void run(stopBuiltInTailnet)}
              />
              <SettingsActionRow
                icon="person.fill.xmark"
                label="Sign out"
                tone="danger"
                disabled={busy}
                onPress={() => void run(signOutBuiltInTailnet)}
              />
            </>
          ) : (
            <SettingsActionRow
              icon="person.crop.circle"
              label={
                status?.state === "needs-login" ? "Sign in to Tailscale" : "Connect or sign in"
              }
              loading={busy}
              disabled={busy || !enabled}
              onPress={() => void signIn()}
            />
          )}
          <SettingsActionRow
            icon="doc.text"
            label={logs === null ? "Show recent log" : "Hide log"}
            onPress={() =>
              logs === null ? void builtInTailnetLogs().then(setLogs) : setLogs(null)
            }
          />
        </SettingsSection>

        <Text className="text-sm text-foreground-muted">{describeStatus(status, signedIn)}</Text>
        <Text className="text-sm text-foreground-muted">
          Built-in Tailscale signs in as its own device. It stays active for phone sharing and direct
          notifications; otherwise it stops when T3 is in the background or after five idle minutes.
          Phone sharing exposes only this phone's T3 server to your tailnet and requires T3 pairing.
        </Text>
        {logs === null ? null : (
          <Text selectable className="font-mono text-xs text-foreground-muted">
            {logs.slice(-60).join("\n") || "No log lines yet."}
          </Text>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
