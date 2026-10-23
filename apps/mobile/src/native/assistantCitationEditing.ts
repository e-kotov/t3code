import {
  assistantCitationFromChip,
  type AssistantCitationChipSelection,
} from "../lib/assistantCitationEdit";

type Listener = (selection: AssistantCitationChipSelection) => void;
const listeners = new Map<string, Set<Listener>>();

export function addAssistantCitationEditListener(draftKey: string, listener: Listener) {
  const subscribers = listeners.get(draftKey) ?? new Set<Listener>();
  subscribers.add(listener);
  listeners.set(draftKey, subscribers);
  return {
    remove: () => {
      subscribers.delete(listener);
      if (subscribers.size === 0 && listeners.get(draftKey) === subscribers)
        listeners.delete(draftKey);
    },
  };
}

export function requestAssistantCitationEdit(
  draftKey: string | null | undefined,
  selection: AssistantCitationChipSelection,
  editor: { readonly readOnly?: boolean; readonly editable?: boolean },
  importing: boolean,
): boolean {
  const subscribers = draftKey ? listeners.get(draftKey) : undefined;
  if (!subscribers || assistantCitationFromChip(selection.source) === null) return false;
  if (editor.readOnly || editor.editable === false || importing) return true;
  for (const subscriber of subscribers) subscriber(selection);
  return true;
}
