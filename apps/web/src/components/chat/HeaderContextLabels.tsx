import { useAtomValue } from "@effect/atom-react";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind, type ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftModelState } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { providerInstanceEntriesFor, shouldShowInstanceBadge } from "../../providerInstances";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { providersIgnoringCheckedAtAtom } from "../../state/server";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { MachineGroupConnectionStatus } from "../MachineGroupConnectionStatus";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { getTriggerDisplayModelName } from "./providerIconUtils";

export function HeaderMachineLabel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { presentation } = useEnvironmentPresentation(threadRef.environmentId);
  if (!presentation) return null;
  const label = presentation.entry.target.label;
  const status = connectionStatusText(presentation.connection);

  return (
    <div data-header-machine className="flex shrink-0 items-center gap-1 border-r border-border pr-2">
      <MachineGroupConnectionStatus environmentId={threadRef.environmentId} />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`Machine: ${label}. ${status}`}
              className="inline-flex min-w-0 cursor-help items-center gap-1.5 rounded-sm text-xs text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <EnvironmentMachineIcon
            kind={resolveEnvironmentMachineKind(presentation.serverConfig)}
            className="size-3.5 shrink-0"
            aria-hidden
          />
          <span className="hidden max-w-24 truncate @min-[28rem]/header-context:block">{label}</span>
        </TooltipTrigger>
        <TooltipPopup>{label}: {status}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

export function HeaderModelLabel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const thread = useQuietThreadShell(threadRef);
  const routeTarget = useThreadRouteTarget();
  const draft = useComposerDraftModelState(
    routeTarget?.kind === "draft" ? routeTarget.draftId : threadRef,
  );
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(threadRef.environmentId));
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const instanceId =
    draft.activeProvider ?? thread?.runtime?.providerInstanceId ?? thread?.modelSelection.instanceId;
  const selection = instanceId
    ? (draft.modelSelectionByProvider[instanceId] ??
      (thread?.modelSelection.instanceId === instanceId ? thread.modelSelection : null))
    : null;
  const entries = providerInstanceEntriesFor(providers, settings, thread?.projectId ?? null);
  const entry = entries.find((candidate) => candidate.instanceId === instanceId);
  const model = entry?.models.find((candidate) => candidate.slug === selection?.model);
  if (!selection?.model) return null;
  const modelLabel = model ? getTriggerDisplayModelName(model, entry?.driverKind) : selection.model;
  const details = `${model?.name ?? selection.model} (${selection.model})${entry ? ` · ${entry.displayName}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-header-model
            aria-label={`Model: ${details}`}
            className="inline-flex max-w-24 min-w-0 shrink-0 cursor-help items-center gap-1.5 rounded-sm text-xs text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring @min-[28rem]/header-context:max-w-36"
          />
        }
      >
        {entry ? (
          <ProviderInstanceIcon
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            accentColor={entry.accentColor}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            showBadge={shouldShowInstanceBadge(entry, entries)}
            size="compact"
          />
        ) : null}
        <span className="truncate">{modelLabel}</span>
      </TooltipTrigger>
      <TooltipPopup>{details}</TooltipPopup>
    </Tooltip>
  );
}
