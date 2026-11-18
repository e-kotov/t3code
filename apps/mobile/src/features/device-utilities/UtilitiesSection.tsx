import { T, useGT } from "gt-react-native";
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
  const gt = useGT();
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
        accessibilityLabel={
          expanded
            ? gt("{name}, {status}, hide details", { name: service.name, status: observed.status })
            : gt("{name}, {status}, show details", { name: service.name, status: observed.status })
        }
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
          <Text className="text-foreground-muted">
            {expanded ? gt("Hide details ⌄") : gt("Details ›")}
          </Text>
        </View>
      </Pressable>
      {expanded ? (
        <View className="gap-3">
          <Text>{observed.reason}</Text>
          <Text className="text-foreground-muted">
            {gt("Last check: {time}", {
              time: run ? new Date(run.startedAt).toLocaleString() : gt("Never"),
            })}
          </Text>
          <View>
            <Text className="text-foreground-muted">
              <T>Last started</T>
            </Text>
            <Text>{utilityTime(observed.result?.startedAt ?? null, now)}</Text>
          </View>
          <View>
            <Text className="text-foreground-muted">
              <T>Last restarted</T>
            </Text>
            <Text>{utilityTime(observed.result?.lastRestartedAt ?? null, now)}</Text>
          </View>
          {observed.result?.checks.map((check) => (
            <View key={check.id} className="gap-1">
              <View className="flex-row flex-wrap justify-between gap-2">
                <Text>
                  {check.name}
                  {!check.required ? gt(" · advisory") : ""}
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
                          gt("{action}?", { action: action.name }),
                          action.scope === "shared"
                            ? gt(
                                "Run on this phone through Termux → {target}\nAffects: shared service (other devices may be affected)\n{command}",
                                { target: service.target, command: action.command },
                              )
                            : gt(
                                "Run on this phone through Termux → {target}\nAffects: this device\n{command}",
                                { target: service.target, command: action.command },
                              ),
                          [
                            { text: gt("Cancel"), style: "cancel" },
                            { text: gt("Run"), onPress: execute },
                          ],
                        );
                      else execute();
                    }}
                  />
                ))
              : null}
            <Button
              label={output ? gt("Hide output") : gt("Check and action output")}
              onPress={() => setOutput(!output)}
            />
          </View>
          {actionRun ? (
            <Text>
              {gt("Action: {result}", {
                result:
                  actionRun.finishedAt === null
                    ? gt("running; awaiting fresh check")
                    : (actionRun.error ??
                      (actionRun.exitCode === 0
                        ? gt("completed; health checked separately")
                        : gt("failed ({code})", { code: actionRun.exitCode }))),
              })}
            </Text>
          ) : null}
          {output ? <Text selectable>{outputText || gt("No output.")}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
export function UtilitiesSection() {
  const gt = useGT();
  const { snapshot, error, now, statuses } = useDeviceUtilities();
  const [settings, setSettings] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh the native utility checks when their dashboard becomes visible.
  useEffect(() => {
    refreshUtilities(true);
  }, []);
  if (!utilitiesAvailable)
    return (
      <Text className="text-foreground-muted">
        <T>
          Install a native build with Utilities support. Existing commands remain available below.
        </T>
      </Text>
    );
  const counts = [...new Set(statuses)]
    .map((s) => `${statuses.filter((v) => v === s).length} ${s}`)
    .join(" · ");
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-t3-medium">
          <T>Services</T>
        </Text>
        <Button label={gt("Check now")} onPress={() => refreshUtilities(true)} />
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
        label={settings ? gt("Hide configuration") : gt("Configure utilities…")}
        onPress={() => setSettings(!settings)}
      />
      {settings || !snapshot?.config ? (
        <View className="gap-3 rounded-xl border border-border p-4">
          <Text className="font-t3-medium">
            <T>Dashboard configuration</T>
          </Text>
          <Text selectable>~/.config/t3-utilities/dashboard.json</Text>
          <Text className="text-foreground-muted">
            <T>
              Managed by phone chezmoi in Termux’s home. T3 imports a device-local copy through
              Termux. Install coreutils in Termux for bounded checks.
            </T>
          </Text>
          <Button label={gt("Import / reload from Termux")} onPress={importUtilities} />
          <Text className="text-foreground-muted">
            <T>
              Refresh and expiry intervals come from the file. Checks pause while T3 is in the
              background.
            </T>
          </Text>
        </View>
      ) : null}
      <Text className="text-foreground-muted">
        <T>Runs through this phone’s Termux, using its scripts and credentials.</T>
      </Text>
    </View>
  );
}
