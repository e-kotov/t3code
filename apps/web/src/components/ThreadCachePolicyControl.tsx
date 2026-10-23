import { useId, useState } from "react";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  CACHE_CHIP_PATH,
  CACHE_CHIP_CLIPS,
  CACHE_CHIP_MODIFIERS,
  cachePolicyChoices,
  cachePolicyDriver,
  threadCachePolicy,
  type ThreadCachePolicy,
} from "@t3tools/shared/threadCachePolicy";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../hooks/useSettings";
import { useEnvironmentScope } from "../state/session";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuGroupLabel,
} from "./ui/menu";

function CacheChip({ policy }: { readonly policy: ThreadCachePolicy }) {
  const maskId = useId();
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <defs>
        <clipPath id={maskId}>
          <path
            d={CACHE_CHIP_CLIPS[policy]}
            clipRule="evenodd"
            fillRule="evenodd"
            fill="currentColor"
          />
        </clipPath>
      </defs>
      <path d={CACHE_CHIP_PATH} clipPath={`url(#${maskId})`} />
      <path d={CACHE_CHIP_MODIFIERS[policy]} />
    </svg>
  );
}

export function ThreadCachePolicyMenu(props: {
  readonly policy: ThreadCachePolicy;
  readonly driver: string | null | undefined;
  readonly canWrite: boolean;
  readonly onChange: (policy: ThreadCachePolicy) => void;
  readonly reveal?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (props.driver !== "codex" && props.driver !== "claudeAgent") return null;
  const label =
    cachePolicyChoices(props.driver).find((choice) => choice.value === props.policy)?.label ??
    "Compact before expiry (Claude only)";
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  disabled={!props.canWrite}
                  aria-label={`Idle cache policy: ${label}`}
                  className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-40 ${props.policy === "warm" ? "text-warning-foreground" : "text-muted-foreground"} ${props.reveal && props.policy === "default" && !open ? "opacity-0 group-any-hover/sidebar-row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" : ""}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(true);
                  }}
                />
              }
            />
          }
        >
          <CacheChip policy={props.policy} />
        </TooltipTrigger>
        <TooltipPopup>Idle cache policy: {label}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" onClick={(event) => event.stopPropagation()}>
        <MenuRadioGroup
          value={props.policy}
          onValueChange={(value) => {
            props.onChange(value as ThreadCachePolicy);
            setOpen(false);
          }}
        >
          <MenuGroupLabel>Idle cache policy</MenuGroupLabel>
          {cachePolicyChoices(props.driver).map((choice) => (
            <MenuRadioItem
              key={choice.value}
              value={choice.value}
              onClick={() => setOpen(false)}
            >
              <span className="flex max-w-72 flex-col">
                <span>{choice.label}</span>
                <span className="text-xs text-muted-foreground">{choice.description}</span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

export function ThreadCachePolicyControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly instanceId?: ProviderInstanceId;
  readonly driver?: string | null | undefined;
  readonly reveal?: boolean | undefined;
}) {
  const policy = useEnvironmentSettings(props.environmentId, (settings) =>
    threadCachePolicy(settings, props.threadId),
  );
  const driver = useEnvironmentSettings(props.environmentId, (settings) =>
    cachePolicyDriver(settings, props.instanceId, props.driver),
  );
  const update = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  return (
    <ThreadCachePolicyMenu
      key={`${props.environmentId}:${props.threadId}`}
      policy={policy}
      driver={driver}
      canWrite={canWrite}
      reveal={props.reveal}
      onChange={(value) => {
        void update({ threadCachePolicies: { [props.threadId]: value } });
      }}
    />
  );
}
