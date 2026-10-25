import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  assistantCitationNavigationForScope,
  finishAssistantCitationNavigation,
  readAssistantCitationNavigation,
  requestAssistantCitationNavigation,
  reconcileAssistantCitationRoute,
} from "./assistantCitationNavigation";

function quote(): AssistantCitation {
  return {
    version: 1,
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("assistant"),
    text: "quoted text",
    start: 0,
    end: 11,
    prefix: "",
    suffix: "",
  };
}

it("only targets the cited environment and thread, including when thread IDs repeat", () => {
  const citation = quote();
  const request = { id: 1, citation, routeSeen: false };
  expect(assistantCitationNavigationForScope(request, "environment", "thread")).toBe(request);
  expect(assistantCitationNavigationForScope(request, "other-environment", "thread")).toBeNull();
  expect(assistantCitationNavigationForScope(request, "environment", "other-thread")).toBeNull();
});

it("cancels when leaving a source route before its feed finishes loading", () => {
  const request = requestAssistantCitationNavigation(quote());
  try {
    reconcileAssistantCitationRoute(request.id, "environment", "origin", true);
    expect(readAssistantCitationNavigation()?.routeSeen).toBe(false);
    reconcileAssistantCitationRoute(request.id, "environment", "thread", true);
    expect(readAssistantCitationNavigation()?.routeSeen).toBe(true);
    reconcileAssistantCitationRoute(request.id, "environment", "thread", false);
    expect(readAssistantCitationNavigation()).toBeNull();
  } finally {
    finishAssistantCitationNavigation(request.id);
  }
});

it("does not let an old completed scroll erase a newer source-navigation request", () => {
  const first = requestAssistantCitationNavigation(quote());
  const second = requestAssistantCitationNavigation(quote());
  try {
    expect(first.id).not.toBe(second.id);
    finishAssistantCitationNavigation(first.id);
    expect(readAssistantCitationNavigation()).toBe(second);
  } finally {
    finishAssistantCitationNavigation(second.id);
  }
  expect(readAssistantCitationNavigation()).toBeNull();
});
