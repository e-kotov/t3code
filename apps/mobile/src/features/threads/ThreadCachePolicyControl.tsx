import { useId } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { MenuAction } from "@react-native-menu/menu";
import { useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import {
  CACHE_CHIP_PATH,
  CACHE_CHIP_MODIFIERS,
  cachePolicyChoices,
  cachePolicyDriver,
  threadCachePolicy,
} from "@t3tools/shared/threadCachePolicy";
import { Pressable } from "react-native";
import Svg, { Circle, Path, Defs, Mask, Rect } from "react-native-svg";
import { ThreadCachePolicyMenu as Menu } from "./ThreadCachePolicyMenu";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

type CacheThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "cacheHud" | "modelSelection"
>;

export function useThreadCachePolicyMenu(thread: CacheThread) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(thread.environmentId));
  const canWrite = useEnvironmentScope(thread.environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    label: "thread idle cache policy",
  });
  const policy = settings ? threadCachePolicy(settings, thread.id) : "default";
  const driver = settings
    ? cachePolicyDriver(settings, thread.modelSelection.instanceId, thread.cacheHud?.driver)
    : thread.cacheHud?.driver;
  const supported = driver === "codex" || driver === "claudeAgent";
  const choices = cachePolicyChoices(driver);
  const actions: MenuAction[] = supported
    ? choices.map((choice) => ({
        id: `cache-policy:${choice.value}`,
        title: choice.label,
        subtitle: choice.description,
        state: policy === choice.value ? "on" : "off",
        attributes: { disabled: !canWrite },
      }))
    : [];
  const handleAction = (event: string) => {
    const choice = choices.find((entry) => event === `cache-policy:${entry.value}`);
    if (!choice) return false;
    if (canWrite)
      void update({
        environmentId: thread.environmentId,
        input: { patch: { threadCachePolicies: { [thread.id]: choice.value } } },
      });
    return true;
  };
  return { policy, actions, handleAction, supported, canWrite };
}

export function ThreadCachePolicyControl({ thread }: { readonly thread: CacheThread }) {
  const menu = useThreadCachePolicyMenu(thread);
  const { themeVariables: colors } = useAppearancePreferences();
  const maskId = useId();
  if (!menu.supported) return null;
  const color =
    menu.policy === "warm"
      ? colors["--color-warning-foreground"]
      : colors["--color-foreground-muted"];
  const label =
    cachePolicyChoices(thread.cacheHud?.driver).find((choice) => choice.value === menu.policy)
      ?.label ?? "Compact before expiry";
  return (
    <Menu
      title="Idle cache policy"
      actions={menu.actions}
      onPressAction={({ nativeEvent }) => {
        menu.handleAction(nativeEvent.event);
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Idle cache policy: ${label}`}
        accessibilityHint="Choose Default, Keep warm, Compact before expiry (Claude), or Off."
        disabled={!menu.canWrite}
        onTouchStart={(event) => event.stopPropagation()}
        className="ml-1 h-11 w-11 items-center justify-center"
        accessibilityState={{ disabled: !menu.canWrite }}
      >
        <Svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Defs>
            <Mask id={maskId}>
              <Rect width={24} height={24} fill="white" stroke="none" />
              {menu.policy === "warm" || menu.policy === "compact" ? (
                <Circle cx={18} cy={18} r={6} fill="black" stroke="none" />
              ) : null}
              {menu.policy === "off" ? (
                <Path d={CACHE_CHIP_MODIFIERS.off} stroke="black" strokeWidth={4.5} />
              ) : null}
            </Mask>
          </Defs>
          <Path d={CACHE_CHIP_PATH} mask={`url(#${maskId})`} />
          <Path d={CACHE_CHIP_MODIFIERS[menu.policy]} />
        </Svg>
      </Pressable>
    </Menu>
  );
}
