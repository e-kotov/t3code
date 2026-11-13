import { getClientSettings } from "~/hooks/useSettings";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";

let pendingCitation: AssistantCitationSourceAnchor | undefined;

type ActiveCite = (text: string) => AssistantCitationSourceAnchor | null;
let activeCite: ActiveCite | undefined;

function releasePendingCitation() {
  pendingCitation?.commentInput?.release();
  pendingCitation = undefined;
}

export function registerActiveCite(cite: ActiveCite) {
  releasePendingCitation();
  activeCite = cite;
  return () => {
    if (activeCite === cite) {
      activeCite = undefined;
      releasePendingCitation();
    }
  };
}

export function citeSelectionInput(event: Event, text: string): boolean {
  if (getClientSettings().typingWithSelection !== "cite") return false;
  const pending = pendingCitation?.commentInput;
  if (
    pending?.pending &&
    pendingCitation?.source.isConnected &&
    window.getSelection()?.isCollapsed
  ) {
    pending.append(text);
    pendingCitation.initialComment = pending.text;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  pendingCitation = activeCite?.(text) ?? undefined;
  if (!pendingCitation) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function handlePendingCitationKey(event: KeyboardEvent): boolean {
  const pending = pendingCitation?.commentInput;
  if (
    pending?.pending &&
    pendingCitation?.source.isConnected &&
    window.getSelection()?.isCollapsed &&
    ["Backspace", "Delete", "Escape", "Enter"].includes(event.key)
  ) {
    if (event.key === "Backspace") pending.backspace();
    if (event.key === "Escape") pending.cancel();
    pendingCitation.initialComment = pending.text;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  return false;
}

export function hasBlockingCitationLayer(layers: NodeListOf<Element>): boolean {
  return Array.from(layers).some(
    (layer) =>
      !pendingCitation?.commentInput?.pending ||
      !layer.querySelector("[data-citation-comment-editor]"),
  );
}
