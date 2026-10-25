import type { AssistantCitation } from "@t3tools/contracts";

export interface AssistantCitationNavigationRequest {
  readonly id: number;
  readonly citation: AssistantCitation;
}

let nextRequest = 0;
let request: AssistantCitationNavigationRequest | null = null;
const listeners = new Set<() => void>();

export function readAssistantCitationNavigation() {
  return request;
}

export function subscribeAssistantCitationNavigation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestAssistantCitationNavigation(citation: AssistantCitation) {
  request = { id: ++nextRequest, citation };
  for (const listener of listeners) listener();
  return request;
}

export function assistantCitationNavigationForScope(
  current: AssistantCitationNavigationRequest | null,
  environmentId: string,
  threadId: string,
) {
  return current?.citation.environmentId === environmentId && current.citation.threadId === threadId
    ? current
    : null;
}

export function finishAssistantCitationNavigation(id: number) {
  if (request?.id !== id) return;
  request = null;
  for (const listener of listeners) listener();
}
