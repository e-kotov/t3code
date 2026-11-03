import { useAtomValue } from "@effect/atom-react";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { threadSupportsProviderHandoff } from "@t3tools/client-runtime/state/thread-workflows";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { resolveEnvironmentMachineKind, type ModelSelection, type ScopedThreadRef } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { useComposerDraftModelState } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { shouldShowInstanceBadge } from "../../providerInstances";
import { useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { providersIgnoringCheckedAtAtom } from "../../state/server";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { MachineGroupConnectionStatus } from "../MachineGroupConnectionStatus";
import { deriveLockedProvider } from "../ChatView.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { getTriggerDisplayModelName } from "./providerIconUtils";
import { useComposerProviderModel } from "./useComposerProviderModel";
import { getComposerPromptInjectionState } from "./composerProviderState";

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

export function HeaderModelLabel({ threadRef, project, defaultModelSelection }: {
  readonly threadRef: ScopedThreadRef;
  readonly project: EnvironmentProject | null;
  readonly defaultModelSelection?: ModelSelection | null | undefined;
}) {
  const thread = useQuietThreadShell(threadRef);
  const projection = useQuietThreadProjection(thread ? threadRef : null);
  const routeTarget = useThreadRouteTarget();
  const target = routeTarget?.kind === "draft" ? routeTarget.draftId : threadRef;
  const draft = useComposerDraftModelState(target);
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(threadRef.environmentId));
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const projectModelSelection = defaultModelSelection !== undefined
    ? defaultModelSelection
    : resolveProjectSettings(settings, project?.id ?? null, project ?? undefined).settings.defaultModelSelection;
  const canHandoff = threadSupportsProviderHandoff(projection?.projection ?? null);
  const lockedProvider = deriveLockedProvider({
    thread,
    selectedProvider: draft.activeProvider,
    threadProvider: thread?.modelSelection.instanceId ?? projectModelSelection?.instanceId ?? null,
    providers,
  });
  const resolved = useComposerProviderModel({
    providerStatuses: providers,
    settings,
    activeProjectId: project?.id ?? thread?.projectId ?? null,
    threadRef: target,
    threadModelSelection: thread?.modelSelection,
    projectModelSelection,
    promptInjectionState: getComposerPromptInjectionState(""),
    candidateInstanceIds: [
      draft.activeProvider,
      thread?.runtime?.providerInstanceId,
      thread?.modelSelection.instanceId,
      projectModelSelection?.instanceId,
    ],
    lockedProvider: canHandoff ? null : lockedProvider,
    lockedInstanceId: canHandoff ? null : thread?.runtime?.providerInstanceId ?? thread?.modelSelection.instanceId,
  });
  const entry = resolved.selectedProviderEntry;
  const retainedSelection = (draft.activeProvider ? draft.modelSelectionByProvider[draft.activeProvider] : null) ?? thread?.modelSelection;
  const modelSlug = entry ? resolved.selectedModel : retainedSelection?.model;
  const model = entry?.models.find((candidate) => candidate.slug === modelSlug);
  if (!modelSlug) return null;
  const modelLabel = model ? getTriggerDisplayModelName(model, entry?.driverKind) : modelSlug;
  const details = `${model?.name ?? modelSlug} (${modelSlug})${entry ? ` · ${entry.displayName}` : ""}`;

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
            showBadge={shouldShowInstanceBadge(entry, resolved.providerInstanceEntries)}
            size="compact"
          />
        ) : null}
        <span className={entry ? "hidden truncate @min-[16rem]/header-context:block" : "truncate"}>{modelLabel}</span>
      </TooltipTrigger>
      <TooltipPopup>{details}</TooltipPopup>
    </Tooltip>
  );
}
