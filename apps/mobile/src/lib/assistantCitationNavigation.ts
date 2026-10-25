import type { AssistantCitation } from "@t3tools/contracts";

export interface AssistantCitationNavigationRequest {
  readonly id: number;
  readonly citation: AssistantCitation;
  readonly routeSeen: boolean;
  readonly routeKey: string | null;
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
  request = { id: ++nextRequest, citation, routeSeen: false, routeKey: null };
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

export function reconcileAssistantCitationRoute(
  id: number,
  environmentId: string | null,
  threadId: string | null,
  focused: boolean,
  routeKey = "source",
) {
  if (request?.id !== id) return;
  const target =
    request.citation.environmentId === environmentId && request.citation.threadId === threadId;
  if (target && focused) {
    if (!request.routeSeen) {
      request = { ...request, routeSeen: true, routeKey };
      for (const listener of listeners) listener();
    }
  } else if (request.routeSeen && (focused || (target && request.routeKey === routeKey))) {
    finishAssistantCitationNavigation(id);
  }
}
