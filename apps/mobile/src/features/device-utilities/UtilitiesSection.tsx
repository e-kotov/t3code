import { utilityColor } from "./utilityColors";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  utilityServiceObservation,
  utilityTime,
  type UtilityService,
  type UtilitySnapshot,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import {
  importUtilities,
  refreshUtilities,
  runUtilityAction,
  useDeviceUtilities,
  utilitiesAvailable,
} from "./utilitiesStore";

function Service({
  service,
  snapshot,
  now,
}: {
  service: UtilityService;
  snapshot: UtilitySnapshot;
  now: number;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState(false);
  const observed = utilityServiceObservation(snapshot, service, now);
  const run = snapshot.checks.find((r) => r.serviceId === service.id);
  const actionRun = snapshot.actions.find((r) => r.serviceId === service.id);
  // The React Compiler cannot lower optional chains inside a `||` left operand.
  const outputText = [run?.stdout, run?.stderr, actionRun?.stdout, actionRun?.stderr]
    .filter(Boolean)
    .join("\n");
  return (
    <View className="gap-3 border-t border-border py-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${service.name}, ${observed.status}, ${expanded ? "hide" : "show"} details`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between gap-3 py-2"
      >
        <View className="flex-1">
          <Text className="font-t3-medium">{service.name}</Text>
          <Text className="text-foreground-muted">{service.target}</Text>
        </View>
        <View className="items-end">
          <Text style={{ color: utilityColor(observed.status, themeAppearance === "dark") }}>
            {observed.status === "unknown" || observed.status === "stale" ? "?" : "●"}{" "}
            {observed.status}
          </Text>
          <Text className="text-foreground-muted">{expanded ? "Hide details ⌄" : "Details ›"}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View className="gap-3">
          <Text>{observed.reason}</Text>
          <Text className="text-foreground-muted">
            Last check: {run ? new Date(run.startedAt).toLocaleString() : "Never"}
          </Text>
          <View>
            <Text className="text-foreground-muted">Last started</Text>
            <Text>{utilityTime(observed.result?.startedAt ?? null, now)}</Text>
          </View>
          <View>
            <Text className="text-foreground-muted">Last restarted</Text>
            <Text>{utilityTime(observed.result?.lastRestartedAt ?? null, now)}</Text>
          </View>
          {observed.result?.checks.map((check) => (
            <View key={check.id} className="gap-1">
              <View className="flex-row flex-wrap justify-between gap-2">
                <Text>
                  {check.name}
                  {!check.required ? " · advisory" : ""}
                </Text>
                <Text style={{ color: utilityColor(check.status, themeAppearance === "dark") }}>
                  {check.status}
                </Text>
              </View>
              <Text className="text-foreground-muted">{check.summary}</Text>
            </View>
          ))}
          <View className="flex-row flex-wrap gap-2">
            {service.enabled
              ? service.actions.map((action) => (
                  <Button
                    key={action.id}
                    label={`${action.name}…`}
                    disabled={actionRun?.finishedAt === null}
                    onPress={() => {
                      const execute = () =>
                        runUtilityAction(service.id, action.id, snapshot.revision);
                      if (action.confirm || action.scope === "shared")
                        Alert.alert(
                          `${action.name}?`,
                          `Run on this phone through Termux → ${service.target}\nAffects: ${action.scope === "shared" ? "shared service (other devices may be affected)" : "this device"}\n${action.command}`,
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Run", onPress: execute },
                          ],
                        );
                      else execute();
                    }}
                  />
                ))
              : null}
            <Button
              label={output ? "Hide output" : "Check and action output"}
              onPress={() => setOutput(!output)}
            />
          </View>
          {actionRun ? (
            <Text>
              Action:{" "}
              {actionRun.finishedAt === null
                ? "running; awaiting fresh check"
                : (actionRun.error ??
                  (actionRun.exitCode === 0
                    ? "completed; health checked separately"
                    : `failed (${actionRun.exitCode})`))}
            </Text>
          ) : null}
          {output ? (
            <Text selectable>{outputText || "No output."}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
export function UtilitiesSection() {
  const { snapshot, error, now, statuses } = useDeviceUtilities();
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    refreshUtilities(true);
  }, []);
  if (!utilitiesAvailable)
    return (
      <Text className="text-foreground-muted">
        Install a native build with Utilities support. Existing commands remain available below.
      </Text>
    );
  const counts = [...new Set(statuses)]
    .map((s) => `${statuses.filter((v) => v === s).length} ${s}`)
    .join(" · ");
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-t3-medium">Services</Text>
        <Button label="Check now" onPress={() => refreshUtilities(true)} />
      </View>
      {counts ? <Text accessibilityLiveRegion="polite">{counts}</Text> : null}
      {error || snapshot?.error ? (
        <Text accessibilityRole="alert">{error ?? snapshot?.error}</Text>
      ) : null}
      {snapshot?.config?.services.map((service) => (
        <Service
          key={`${snapshot.revision}:${service.id}`}
          service={service}
          snapshot={snapshot}
          now={now}
        />
      ))}
      <Button
        label={settings ? "Hide configuration" : "Configure utilities…"}
        onPress={() => setSettings(!settings)}
      />
      {settings || !snapshot?.config ? (
        <View className="gap-3 rounded-xl border border-border p-4">
          <Text className="font-t3-medium">Dashboard configuration</Text>
          <Text selectable>~/.config/t3-utilities/dashboard.json</Text>
          <Text className="text-foreground-muted">
            Managed by phone chezmoi in Termux’s home. T3 imports a device-local copy through
            Termux. Install coreutils in Termux for bounded checks.
          </Text>
          <Button label="Import / reload from Termux" onPress={importUtilities} />
          <Text className="text-foreground-muted">
            Refresh and expiry intervals come from the file. Checks pause while T3 is in the
            background.
          </Text>
        </View>
      ) : null}
      <Text className="text-foreground-muted">
        Runs through this phone’s Termux, using its scripts and credentials.
      </Text>
      <Text className="font-t3-medium">Commands</Text>
    </View>
  );
}
