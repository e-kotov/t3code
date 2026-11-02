import { type ServerProvider, type ProviderDriverKind } from "@t3tools/contracts";
import type { LimitPresentations } from "@t3tools/shared/usageLimits";
import { threadSupportsProviderHandoff } from "@t3tools/client-runtime/state/thread-workflows";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { DraftId, useComposerDraftModelState } from "../composerDraftStore";
import { useQuietThreadShell, useQuietThreadProjection, useProjects } from "../state/entities";
import { usePrimarySettings } from "../hooks/useSettings";
import {
  deriveLockedProvider,
  resolveComposerProviderSelection,
} from "../components/ChatView.logic";
import { deriveEffectiveComposerModelState } from "../composerDraftStore";
import { providerInstanceEntriesFor, NO_PROVIDER_MODEL_SELECTION } from "../providerInstances";

const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];

export function useActiveComposerSelection(presentations?: LimitPresentations): {
  readonly activeModel: string | null;
  readonly activeDriver: string | null;
} {
  const routeTarget = useThreadRouteTarget();
  const draftTarget =
    routeTarget?.kind === "draft"
      ? routeTarget.draftId
      : routeTarget?.kind === "server"
        ? routeTarget.threadRef
        : DraftId.make("idle");

  const draftModelState = useComposerDraftModelState(draftTarget);
  const activeThread = useQuietThreadShell(
    routeTarget?.kind === "server" ? routeTarget.threadRef : null,
  );
  const threadProjection = useQuietThreadProjection(
    routeTarget?.kind === "server" ? routeTarget.threadRef : null,
  );
  const supportsProviderSwitchingViaHandoff = threadSupportsProviderHandoff(
    threadProjection?.projection ?? null,
  );

  const projects = useProjects();
  const activeProject = activeThread
    ? (projects.find(
        (p) => p.environmentId === activeThread.environmentId && p.id === activeThread.projectId,
      ) ?? null)
    : null;

  const settings = usePrimarySettings();

  const providerStatuses = (() => {
    if (!presentations) return EMPTY_PROVIDERS;
    if (activeThread) {
      const envProviders = presentations.get(activeThread.environmentId)?.serverConfig?.providers;
      if (envProviders && envProviders.length > 0) return envProviders;
    }
    return [...presentations.values()].flatMap((p) => p.serverConfig?.providers ?? []);
  })();

  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;

  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: draftModelState.activeProvider ?? null,
    threadProvider,
    providers: providerStatuses,
  });

  const modelPickerLockedProvider = supportsProviderSwitchingViaHandoff ? null : lockedProvider;

  const providerInstanceEntries = providerInstanceEntriesFor(
    providerStatuses,
    settings,
    activeProject?.id ?? null,
  );

  const selection = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: [
      draftModelState.activeProvider ?? null,
      activeThread?.runtime?.providerInstanceId,
      activeThread?.modelSelection?.instanceId,
      activeProject?.defaultModelSelection?.instanceId,
    ],
    lockedProvider: modelPickerLockedProvider,
    lockedInstanceId: supportsProviderSwitchingViaHandoff
      ? null
      : (activeThread?.runtime?.providerInstanceId ?? activeThread?.modelSelection?.instanceId),
  });

  const selectedInstanceId =
    selection.selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const selectedProvider: ProviderDriverKind =
    selection.selectedProviderEntry?.driverKind ?? selection.requestedDriverKind;

  const modelState = deriveEffectiveComposerModelState({
    draft: draftModelState,
    providers: providerStatuses,
    selectedProvider,
    selectedInstanceId,
    requestedInstanceId: selection.requestedInstanceId,
    threadModelSelection: activeThread?.modelSelection,
    projectModelSelection: activeProject?.defaultModelSelection,
    settings,
  });

  return {
    activeModel: modelState.selectedModel ?? null,
    activeDriver: selectedProvider ?? null,
  };
}
