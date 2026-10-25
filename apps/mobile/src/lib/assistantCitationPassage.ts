export interface AssistantCitationPassageLocation {
  readonly requestId: number;
  readonly found: boolean;
  readonly delta: number | null;
}

export function createAssistantCitationPassageActivation() {
  let active: number | null = null;
  let consumed = false;
  return {
    begin(requestId: number) {
      active = requestId;
      consumed = false;
    },
    cancel() {
      active = null;
    },
    consume(location: AssistantCitationPassageLocation): number | null {
      if (active !== location.requestId || consumed) return null;
      consumed = true;
      return location.found && location.delta !== null && Number.isFinite(location.delta)
        ? location.delta
        : null;
    },
  };
}
